import { backoffDelay, isRetriableStatus } from '../../shared/backoff'
import type { OutboxTask } from '../../shared/types'
import { ApiError, apiFetch } from '../api/client'
import { db } from '../db/schema'

export interface ConflictInfo {
  note_id: string
  /** 被本次推送覆盖掉的服务端正文（服务端随 conflicted 响应带回），要另存为冲突副本 */
  body: string
}

export interface PushResult {
  sent: number
  failed: number
  /** outbox 里累计处于失败态的任务数，界面据此提示用户 */
  failedTotal: number
  conflicts: ConflictInfo[]
}

interface ServerAck {
  version?: number
  prop_version?: number
  update_time?: number
  conflicted?: boolean
  previous_content?: string
}

function post(path: string, payload: unknown) {
  return apiFetch<ServerAck>(path, { method: 'POST', body: JSON.stringify(payload) })
}

function patch(path: string, payload: unknown) {
  return apiFetch<ServerAck>(path, { method: 'PATCH', body: JSON.stringify(payload) })
}

async function send(task: OutboxTask): Promise<ServerAck> {
  // 基线必须取“实际发出这一刻”服务端已确认的版本。
  // 任务入队后，前一条 create/body 请求可能已经成功，或者请求在途期间
  // 用户又编辑了正文；此时 outbox 里保存的 base_version/base_prop_version
  // 可能已经过期。继续使用旧基线会把客户端自己的连续编辑误判成冲突。
  let payload = (task.payload ?? {}) as Record<string, unknown>
  if (task.kind === 'body' || task.kind === 'prop') {
    const note = await db.notes.get(task.note_id)
    if (note) {
      payload = {
        ...payload,
        ...(task.kind === 'body'
          ? { base_version: note.version }
          : { base_prop_version: note.prop_version }),
      }
    }
  }
  const isGroup = payload.scope === 'group'

  if (isGroup) {
    if (task.kind === 'create') return post('/api/groups', payload)
    if (task.kind === 'prop') return patch(`/api/groups/${task.note_id}`, payload)
    return apiFetch<ServerAck>(`/api/groups/${task.note_id}`, { method: 'DELETE' })
  }

  switch (task.kind) {
    case 'create':
      return post('/api/notes', payload)
    case 'body':
    case 'prop':
      return patch(`/api/notes/${task.note_id}`, payload)
    case 'trash':
      return post(`/api/notes/${task.note_id}/trash`, {})
    case 'recover':
      return post(`/api/notes/${task.note_id}/recover`, {})
    case 'purge':
      return payload.scope === 'trash'
        ? post('/api/trash/clean', {})
        : post(`/api/notes/${task.note_id}/purge`, {})
  }
}

/** 本次任务负责清掉哪一位脏标记；其余位必须原样保留 */
function clearBit(dirty: string, kind: OutboxTask['kind']): string {
  // create 同时落了正文与属性，整条笔记自此与本地一致，两位都清
  if (kind === 'create') return 'none'

  const cleared = kind === 'body' ? 'body' : 'prop'
  if (dirty === 'both') return cleared === 'body' ? 'prop' : 'body'
  return dirty === cleared ? 'none' : dirty
}

async function applyAck(task: OutboxTask, ack: ServerAck) {
  const note = await db.notes.get(task.note_id)
  if (!note) return

  const fields: Record<string, unknown> = { dirty: clearBit(note.dirty, task.kind) }
  if (typeof ack.version === 'number') {
    fields.version = ack.version
    // 本地正文此刻就等于服务端这个版本。不写 body_version，
    // 下一轮 pull 会认为远端更新而把正文再拉回来覆盖掉刚推上去的内容。
    if (task.kind === 'body' || task.kind === 'create') fields.body_version = ack.version
  }
  if (typeof ack.prop_version === 'number') fields.prop_version = ack.prop_version
  if (typeof ack.update_time === 'number') fields.update_time = ack.update_time

  await db.notes.update(task.note_id, fields)
}

export async function pushOnce(): Promise<PushResult> {
  const now = Date.now()
  const result: PushResult = { sent: 0, failed: 0, failedTotal: 0, conflicts: [] }

  const tasks = await db.outbox.orderBy('id').toArray()

  // create 尚未成功（本轮被退避跳过、请求失败或已标记 failed）的笔记 / 分组，
  // 它名下排在后面的 body/prop/trash… 任务这一轮一律挂起：服务端还没有这一行，
  // 发出去只会 404，而 404 路径会把任务当作「服务端已物理删除」丢弃——
  // 等 create 重试成功后，这些编辑就再也推不上去了。
  const blocked = new Set<string>()

  for (const task of tasks) {
    if (blocked.has(task.note_id)) continue

    if (task.failed === 1 || task.next_at > now) {
      if (task.kind === 'create') blocked.add(task.note_id)
      continue
    }

    try {
      const ack = await send(task)

      // 后写者胜：本地这版已经成了服务端正文，再存它一份只会得到两条一样的笔记。
      // 真正会丢的是被覆盖的那一版——服务端随 conflicted 把它带回来，副本存它。
      // 只有正文冲突才带 previous_content；属性被覆盖不值得多出一条笔记。
      if (ack.conflicted && typeof ack.previous_content === 'string') {
        result.conflicts.push({ note_id: task.note_id, body: ack.previous_content })
      }

      await applyAck(task, ack)

      if (task.id !== undefined) {
        // 请求在途期间用户可能又改了同一条，enqueue 会把新 payload 合并进这一行并递增 seq。
        // 直接 delete 就等于把那次改动静默丢掉，所以先比对 seq。
        const current = await db.outbox.get(task.id)
        if (current && current.seq === task.seq) await db.outbox.delete(task.id)
      }
      result.sent++
    } catch (error) {
      if (task.kind === 'create') blocked.add(task.note_id)

      const status = error instanceof ApiError ? error.status : 0

      // 401 不消耗任务：令牌修复后应能续传。
      // 同时必须 break：clearToken 已经把令牌清了，剩下每条任务再发也是注定 401。
      // 不 break 的话，outbox 里几百条任务就是几百个空转请求，白烧流量、还拖慢界面
      // 切回 TokenGate。break 后这些任务原样留在库里，重新登录后的首轮继续推。
      if (status === 401) {
        result.failed++
        break
      }

      // 404 not_found = 服务端已经物理删掉这条笔记/分组的行（墓碑过了保留期、
      // 或从未建成）。任务永远没有成功可能，标记 failed 只会让「改动未推送」的
      // 红点永远消不掉；按 worker/db.ts 的既有约定直接丢弃任务，不卡死。
      // 只删这一行，不动本地笔记副本——同一轮 pull 的墓碑路径会负责清本地。
      if (status === 404) {
        if (task.id !== undefined) {
          const current = await db.outbox.get(task.id)
          if (current && current.seq === task.seq) await db.outbox.delete(task.id)
        }
        continue
      }

      // 不可重试的 4xx 标记失败留在库里。丢弃等于静默吞掉用户的一次写入，
      // 用户既看不到也救不回来。留着才能提示、才能手动重试。
      if (status >= 400 && status < 500 && !isRetriableStatus(status)) {
        if (task.id !== undefined) await db.outbox.update(task.id, { failed: 1 })
        result.failed++
        continue
      }

      const retry = task.retry + 1
      if (task.id !== undefined) {
        await db.outbox.update(task.id, { retry, next_at: Date.now() + backoffDelay(retry - 1) })
      }
      result.failed++
    }
  }

  result.failedTotal = await db.outbox.where('failed').equals(1).count()
  return result
}
