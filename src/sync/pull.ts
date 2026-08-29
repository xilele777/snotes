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
import { db } from '../db/schema'
import { emitRemoteApplied } from './signal'

export const SYNC_CURSOR_KEY = 'sync_cursor'

const BODY_BATCH = 50

export interface PullResult {
  pages: number
  applied: number
  bodies: number
}

function toLocalNote(meta: NoteMeta): LocalNote {
  // 打开统计不属于笔记内容同步，新拉下来的笔记从本设备 / 其它设备统计 0 起算。
  return {
    ...meta, body: '', body_version: 0, dirty: 'none', open_count: 0, last_open_time: 0,
    open_others: 0, open_others_time: 0,
  }
}

/** outbox 里还有未失败的正文类任务的笔记——它们的正文不能被远端覆盖 */
async function pendingBodyIds(): Promise<Set<string>> {
  const tasks = await db.outbox.where('failed').equals(0).toArray()
  return new Set(
    tasks.filter((t) => t.kind === 'body' || t.kind === 'create').map((t) => t.note_id)
  )
}

async function localStates(): Promise<Map<string, LocalNoteState>> {
  const [all, pending] = await Promise.all([db.notes.toArray(), pendingBodyIds()])
  return new Map(
    all.map((n) => [
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

export async function pullOnce(): Promise<PullResult> {
  const since = (await getMeta<number>(SYNC_CURSOR_KEY)) ?? 0

  let cursor: string | null = null
  let serverTime: number | null = null
  let pages = 0
  let applied = 0

  const pendingBodies: string[] = []

  // 逐页拉取。任何一页抛错都会直接冒泡，从而跳过下面的游标推进。
  for (;;) {
    const response: PullResponse = await apiFetch<PullResponse>('/api/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ since, cursor }),
    })

    pages++
    if (serverTime === null) serverTime = response.server_time

    await applyGroups(response.groups)

    const plan = planPull(response.notes, await localStates())

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
        invalid: note.invalid,
        prop_version: note.prop_version,
        update_time: note.update_time,
      })
    }

    if (plan.deleteLocal.length > 0) {
      // 远端墓碑：物理删本地副本，并清掉它名下所有未推送任务——
      // 该笔记在服务端已不存在，剩下的 create/body/prop 推上去也只会 not_found。
      await db.notes.bulkDelete(plan.deleteLocal.map((n) => n.id))
      for (const note of plan.deleteLocal) {
        await db.outbox.where('note_id').equals(note.id).delete()
      }
    }

    applied += plan.insert.length + plan.updateProp.length + plan.deleteLocal.length
    pendingBodies.push(...plan.fetchBody)

    cursor = response.next_cursor
    if (!cursor) break
  }

  // 正文按批拉取。同样，失败即冒泡，游标不推进。
  let bodies = 0
  for (let i = 0; i < pendingBodies.length; i += BODY_BATCH) {
    const ids = pendingBodies.slice(i, i + BODY_BATCH)

    const response = await apiFetch<BodiesResponse>('/api/sync/bodies', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })

    for (const body of response.bodies) {
      const local = await db.notes.get(body.note_id)
      if (!local) continue

      // 版本低于本地说明本地这份正文已经是更新版本了，覆盖下去会丢字。
      // 用 < 而非 <=：body.version 与 body_version 相等时仍允许写入——
      // 此时本地正文来自一条已失败的 push 任务（failed=1），它再也不会把本地内容
      // 推上去，本地与远端就再也不会自然收敛，必须靠这里强制对齐到远端。
      if (body.version < local.body_version) continue

      await db.notes.update(body.note_id, {
        body: body.content,
        body_version: body.version,
        version: body.version,
      })
      bodies++
    }
  }

  // 只有全部分页与全部正文批次都成功，才推进游标。
  if (serverTime !== null) {
    await setMeta(SYNC_CURSOR_KEY, serverTime)
  }

  // 通知界面重新读库。没有这一声，远端拉下来的改动要等下一次用户操作才显示。
  if (applied > 0 || bodies > 0) emitRemoteApplied()

  return { pages, applied, bodies }
}

