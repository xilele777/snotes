import { derive } from '../../shared/derive'
import { planPull } from '../../shared/sync-reduce'
import type {
  BodiesResponse,
  Group,
  LocalNote,
  LocalNoteState,
  NoteMeta,
  PullResponse,
} from '../../shared/types'
import { ApiError, apiFetch } from '../api/client'
import { createConflictCopy, getMeta, setMeta } from '../db/repo'
import { deleteHistoryIn } from '../db/history'
import { db } from '../db/schema'
import { emitRemoteApplied } from './signal'
import { enqueueOpensUnknownIn } from './opens'
import { SYNC_CHECKPOINT_KEY } from './checkpoint'

export const SYNC_CURSOR_KEY = 'sync_cursor'
/** meta 表里缓存的回收站保留天数，回收站页在首次同步前也能给出提示 */
export const TRASH_RETENTION_KEY = 'trash_retention_days'

const BODY_BATCH = 50

export interface PullResult {
  pages: number
  applied: number
  bodies: number
  /** 本轮写入本地的分组数 */
  groups: number
  /** 服务端配置的回收站保留天数；旧服务端不带这个字段时为 undefined */
  trashRetentionDays?: number | null
}

function toLocalNote(meta: NoteMeta): LocalNote {
  // 打开统计不属于笔记内容同步，新拉下来的笔记从本设备 0 次起算。
  // open_others 刻意不写：undefined 表示「还没问过服务端」，下一次 opens 同步会
  // 点名补上别的设备的旧计数；写成 0 就等于把这条笔记的聚合值永远钉在 0 了。
  return {
    ...meta, body: '', body_version: 0, dirty: 'none', open_count: 0, last_open_time: 0,
  }
}

const isBodyTask = (kind: string) => kind === 'body' || kind === 'create'

/** 未确认的正文（包括永久失败、等待人工处理的任务）都不能被远端覆盖。 */
async function pendingBodyIds(): Promise<Set<string>> {
  const tasks = await db.outbox.toArray()
  return new Set(tasks.filter((t) => isBodyTask(t.kind)).map((t) => t.note_id))
}

async function localStates(ids: string[]): Promise<Map<string, LocalNoteState>> {
  // Pull pages contain metadata only. Fetch just the rows in the current page;
  // cloning every local body for every page was the main cold-start cost after
  // IndexedDB was cleared.
  const [all, pending] = await Promise.all([db.notes.bulkGet(ids), pendingBodyIds()])
  return new Map(
    all.filter((n): n is LocalNote => !!n).map((n) => [
      n.id,
      {
        id: n.id,
        version: n.version,
        body_version: n.body_version,
        prop_version: n.prop_version,
        body_pending: pending.has(n.id),
      },
    ])
  )
}

async function applyGroups(groups: Group[]) {
  if (groups.length === 0) return
  await db.transaction('rw', db.groups, db.outbox, async () => {
    const pending = new Set((await db.outbox.toArray()).filter(task => (task.payload as { scope?: string })?.scope === 'group').map(task => task.note_id))
    await db.groups.bulkPut(groups.filter(group => !pending.has(group.group_id)))
  })
}

/**
 * 把一批远端正文落库，返回实际写入的数量。
 * 检查与写入放在同一个事务里：planPull 那会儿没有待推送正文，不代表现在也没有——
 * 拉正文这段时间用户可能又保存了一次。此时若照常落库，本地看到的就变成远端旧正文，
 * 而 outbox 里那条任务随后照常推上去，本地正文和将要上传的内容就不是同一份了。
 */
function applyBodies(bodies: BodiesResponse['bodies'], reconcile = false): Promise<number> {
  return db.transaction('rw', db.notes, db.outbox, db.history, async () => {
    const [rows, pending] = await Promise.all([
      db.notes.bulkGet(bodies.map(body => body.note_id)), pendingBodyIds(),
    ])
    const updates: LocalNote[] = []
    for (const [index, body] of bodies.entries()) {
      const local = rows[index]
      // 同版本可修复缺失正文，但不能替换尚未确认的本地输入。
      if (!local) continue
      if (pending.has(body.note_id)) {
        if (reconcile) await db.notes.update(local.id, { version: 0 })
        continue
      }
      if (!reconcile && body.version < local.body_version) continue
      if (reconcile && local.body !== body.content && local.body.trim()) {
        await db.history.add({ note_id: local.id, body: local.body, time: local.update_time })
      }
      updates.push({
        ...local, body: body.content, body_version: body.version, version: body.version,
        ...derive(body.content),
      })
    }
    if (updates.length) await db.notes.bulkPut(updates)
    return updates.length
  })
}

export async function pullOnce(reconcile = false): Promise<PullResult> {
  const since = reconcile ? 0 : (await getMeta<number>(SYNC_CURSOR_KEY)) ?? 0
  const checkpoint = await getMeta<string>(SYNC_CHECKPOINT_KEY) ?? null
  // Only reconcile rows that existed when this request started. A note created
  // while the inventory is downloading must never be mistaken for a deletion.
  const originalIds = reconcile ? await db.notes.toCollection().primaryKeys() : []
  const originalGroups = reconcile ? await db.groups.toCollection().primaryKeys() : []
  const seenGroups = new Set<string>()
  const seen = new Set<string>()
  let nextCheckpoint: string | undefined

  let cursor: string | null = null
  let serverTime: number | null = null
  let pages = 0
  let applied = 0
  let groups = 0
  let trashRetentionDays: number | null | undefined

  const pendingBodies: string[] = []

  // 逐页拉取。任何一页抛错都会直接冒泡，从而跳过下面的游标推进。
  for (;;) {
    const response: PullResponse | null = await apiFetch<PullResponse>('/api/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ since, cursor, checkpoint }),
    }).catch(error => {
      if (!reconcile && pages === 0 && error instanceof ApiError && error.status === 409 && (error.data as { error?: string })?.error === 'sync_reset_required') return null
      throw error
    })
    if (!response) return pullOnce(true)

    pages++
    if (serverTime === null) { serverTime = response.server_time; nextCheckpoint = response.checkpoint }
    response.notes.forEach(note => seen.add(note.id))
    response.groups.forEach(group => seenGroups.add(group.group_id))
    if (response.trash_retention_days !== undefined) trashRetentionDays = response.trash_retention_days

    await applyGroups(response.groups)
    groups += response.groups.length

    const states = await localStates(response.notes.map(note => note.id))
    if (reconcile) states.forEach(state => { state.body_version = -1; state.prop_version = -1 })
    const plan = planPull(response.notes, states)

    if (plan.insert.length > 0) {
      // 必须是 bulkPut：since 用的是 >=，同一条笔记本就可能在一页里重复出现，
      // bulkAdd 会抛 ConstraintError 让整轮失败，游标永不推进，同步彻底卡死。
      // 新笔记的 open_others 未知，与插入同事务进 opens 点名队列。
      await db.transaction('rw', db.notes, db.meta, async () => {
        await db.notes.bulkPut(plan.insert.map(toLocalNote))
        await enqueueOpensUnknownIn(plan.insert.map((note) => note.id))
      })
    }

    for (const note of plan.updateProp) {
      await db.transaction('rw', db.notes, db.outbox, async () => {
        const tasks = await db.outbox.where('note_id').equals(note.id).toArray()
        // Force the server to retain its previous body when pending local text
        // is sent after a restore, even if its version counter moved backwards.
        if (reconcile && tasks.some(task => isBodyTask(task.kind))) await db.notes.update(note.id, { version: 0 })
        if (tasks.some(task => task.kind !== 'body')) {
          if (reconcile) await db.notes.update(note.id, { prop_version: 0 })
          return
        }
        await db.notes.update(note.id, {
          group_id: note.group_id,
          star: note.star,
          top: note.top,
          skin_color: note.skin_color,
          home_hidden: note.home_hidden ?? null,
          invalid: note.invalid,
          prop_version: note.prop_version,
          update_time: note.update_time,
        })
      })
    }

    if (plan.deleteLocal.length > 0) {
      await db.transaction('rw', db.notes, db.outbox, db.history, db.knowledgeBaseNoteStates, db.meta, async () => {
        for (const removed of plan.deleteLocal) {
          const local = await db.notes.get(removed.id)
          const pending = await db.outbox.where('note_id').equals(removed.id).toArray()
          if (local && pending.some(task => isBodyTask(task.kind)) && local.body.trim()) {
            await createConflictCopy(local, local.body)
          }
        }
        await db.knowledgeBaseNoteStates.bulkPut(plan.deleteLocal.map(n => ({ id: n.id, state: 'purged' as const })))
        // 未确认的正文已另存副本，再原子清掉墓碑及其残留任务和历史。
        await db.notes.bulkDelete(plan.deleteLocal.map((n) => n.id))
        await deleteHistoryIn(plan.deleteLocal.map((n) => n.id))
        for (const note of plan.deleteLocal) {
          await db.outbox.where('note_id').equals(note.id).delete()
        }
      })
    }

    applied += plan.insert.length + plan.updateProp.length + plan.deleteLocal.length
    pendingBodies.push(...plan.fetchBody)

    cursor = response.next_cursor
    if (!cursor) break
  }

  // A new device can show titles immediately instead of waiting for every
  // full body. NoteDetail keeps an undownloaded body read-only/loading.
  if (since === 0 && applied > 0) emitRemoteApplied()

  // 正文按批拉取。同样，失败即冒泡，游标不推进。
  let bodies = 0
  // Metadata is ordered oldest first; download the newest (visible) notes
  // first so a user can open them while older notes continue in the background.
  const bodyIds = [...new Set(pendingBodies)].reverse()
  const batches = Array.from({ length: Math.ceil(bodyIds.length / BODY_BATCH) }, (_, index) =>
    bodyIds.slice(index * BODY_BATCH, (index + 1) * BODY_BATCH)
  )
  // Independent requests share at most three connections. Apply each completed
  // batch immediately so one slow request cannot hold the first editor hostage.
  let firstBodiesShown = false
  for (let offset = 0; offset < batches.length; offset += 3) {
    // Bound concurrency/memory on devices with thousands of notes, and settle
    // all requests before surfacing a failure so retries cannot overlap them.
    const results = await Promise.allSettled(batches.slice(offset, offset + 3).map(async ids => {
      const response = await apiFetch<BodiesResponse>('/api/sync/bodies', {
        method: 'POST', body: JSON.stringify({ ids }),
      })
      if (ids.some(id => !response.bodies.some(body => body.note_id === id))) {
        throw new Error('部分正文尚不可用，已保留本地内容与同步游标，请重试同步')
      }
      const count = await applyBodies(response.bodies, reconcile)
      if (since === 0 && !firstBodiesShown && count > 0) {
        firstBodiesShown = true
        emitRemoteApplied()
      }
      return count
    }))
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      bodies += result.value
    }
  }

  // Full inventories span multiple requests. Refuse destructive reconciliation
  // if writes moved rows while pagination or body downloads were in flight.
  if (reconcile && nextCheckpoint && serverTime !== null) {
    const current = await apiFetch<{ valid: boolean }>('/api/sync/checkpoint', {
      method: 'POST', body: JSON.stringify({ since: serverTime, checkpoint: nextCheckpoint, require_current: true }),
    })
    if (!current.valid) throw new Error('对账期间远端内容发生变化，已保留本地记录，请重试同步')
  }

  // 只有全部分页与全部正文批次都成功，才推进游标。
  await db.transaction('rw', [db.notes, db.groups, db.outbox, db.history, db.meta, db.knowledgeBaseNoteStates], async () => {
    if (reconcile) {
      const pendingGroups = new Set((await db.outbox.toArray()).filter(t => (t.payload as { scope?: string })?.scope === 'group').map(t => t.note_id))
      for (const id of originalGroups) if (!seenGroups.has(id) && !pendingGroups.has(id)) {
        await db.groups.update(id, { invalid: 1 })
        await db.notes.where('group_id').equals(id).modify({ group_id: null })
      }
      for (const id of originalIds) {
        if (seen.has(id)) continue
        const local = await db.notes.get(id)
        if (!local) continue
        const tasks = await db.outbox.where('note_id').equals(id).toArray()
        // A never-confirmed local creation belongs to this device, not to the
        // server inventory. Existing creations retain their id and queue.
        if (tasks.some(task => task.kind === 'create')) continue
        // An old backup cannot tell us whether a missing row was deleted or
        // created after that backup. Preserve its text in a recovery copy.
        if (local.body.trim()) await createConflictCopy(local, local.body)
        await db.notes.delete(id)
        await db.outbox.where('note_id').equals(id).delete()
        await deleteHistoryIn([id])
        await db.knowledgeBaseNoteStates.put({ id, state: 'purged' })
        applied++
      }
    }
    if (serverTime !== null) await setMeta(SYNC_CURSOR_KEY, serverTime)
    if (nextCheckpoint) await setMeta(SYNC_CHECKPOINT_KEY, nextCheckpoint)
  })
  if (trashRetentionDays !== undefined) await setMeta(TRASH_RETENTION_KEY, trashRetentionDays)

  // 通知界面重新读库。没有这一声，远端拉下来的改动要等下一次用户操作才显示。
  // 分组也算：另一台设备新建或重命名分组时，侧栏同样要刷新。
  if (applied > 0 || bodies > 0 || groups > 0) emitRemoteApplied()

  return { pages, applied, bodies, groups, trashRetentionDays }
}
