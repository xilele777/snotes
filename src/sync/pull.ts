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
import { apiFetch } from '../api/client'
import { getMeta, setMeta } from '../db/repo'
import { deleteHistoryIn } from '../db/history'
import { db } from '../db/schema'
import { emitRemoteApplied } from './signal'

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

/** outbox 里还有未失败的正文类任务的笔记——它们的正文不能被远端覆盖 */
async function pendingBodyIds(): Promise<Set<string>> {
  const tasks = await db.outbox.where('failed').equals(0).toArray()
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
  await db.groups.bulkPut(groups)
}

/**
 * 把一批远端正文落库，返回实际写入的数量。
 * 检查与写入放在同一个事务里：planPull 那会儿没有待推送正文，不代表现在也没有——
 * 拉正文这段时间用户可能又保存了一次。此时若照常落库，本地看到的就变成远端旧正文，
 * 而 outbox 里那条任务随后照常推上去，本地正文和将要上传的内容就不是同一份了。
 */
function applyBodies(bodies: BodiesResponse['bodies']): Promise<number> {
  return db.transaction('rw', db.notes, db.outbox, async () => {
    const [rows, pending] = await Promise.all([
      db.notes.bulkGet(bodies.map(body => body.note_id)), pendingBodyIds(),
    ])
    const updates: LocalNote[] = []
    for (const [index, body] of bodies.entries()) {
      const local = rows[index]
      // Equal versions still repair a body left by a permanently failed push.
      if (!local || body.version < local.body_version || pending.has(body.note_id)) continue
      updates.push({
        ...local, body: body.content, body_version: body.version, version: body.version,
        ...derive(body.content),
      })
    }
    if (updates.length) await db.notes.bulkPut(updates)
    return updates.length
  })
}

export async function pullOnce(): Promise<PullResult> {
  const since = (await getMeta<number>(SYNC_CURSOR_KEY)) ?? 0

  let cursor: string | null = null
  let serverTime: number | null = null
  let pages = 0
  let applied = 0
  let groups = 0
  let trashRetentionDays: number | null | undefined

  const pendingBodies: string[] = []

  // 逐页拉取。任何一页抛错都会直接冒泡，从而跳过下面的游标推进。
  for (;;) {
    const response: PullResponse = await apiFetch<PullResponse>('/api/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ since, cursor }),
    })

    pages++
    if (serverTime === null) serverTime = response.server_time
    if (response.trash_retention_days !== undefined) trashRetentionDays = response.trash_retention_days

    await applyGroups(response.groups)
    groups += response.groups.length

    const plan = planPull(response.notes, await localStates(response.notes.map(note => note.id)))

    if (plan.insert.length > 0) {
      // 必须是 bulkPut：since 用的是 >=，同一条笔记本就可能在一页里重复出现，
      // bulkAdd 会抛 ConstraintError 让整轮失败，游标永不推进，同步彻底卡死。
      await db.notes.bulkPut(plan.insert.map(toLocalNote))
    }

    for (const note of plan.updateProp) {
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
    }

    if (plan.deleteLocal.length > 0) {
      await db.knowledgeBaseNoteStates.bulkPut(plan.deleteLocal.map(n => ({ id: n.id, state: 'purged' as const })))
      // 远端墓碑：物理删本地副本，并清掉它名下所有未推送任务——
      // 该笔记在服务端已不存在，剩下的 create/body/prop 推上去也只会 not_found。
      await db.notes.bulkDelete(plan.deleteLocal.map((n) => n.id))
      await deleteHistoryIn(plan.deleteLocal.map((n) => n.id))
      for (const note of plan.deleteLocal) {
        await db.outbox.where('note_id').equals(note.id).delete()
      }
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
      const count = await applyBodies(response.bodies)
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

  // 只有全部分页与全部正文批次都成功，才推进游标。
  if (serverTime !== null) {
    await setMeta(SYNC_CURSOR_KEY, serverTime)
  }
  if (trashRetentionDays !== undefined) await setMeta(TRASH_RETENTION_KEY, trashRetentionDays)

  // 通知界面重新读库。没有这一声，远端拉下来的改动要等下一次用户操作才显示。
  // 分组也算：另一台设备新建或重命名分组时，侧栏同样要刷新。
  if (applied > 0 || bodies > 0 || groups > 0) emitRemoteApplied()

  return { pages, applied, bodies, groups, trashRetentionDays }
}
