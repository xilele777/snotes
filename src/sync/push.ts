import { backoffDelay, isRetriableStatus } from '../../shared/backoff'
import type { OutboxTask } from '../../shared/types'
import { ApiError, apiFetch } from '../api/client'
import { db } from '../db/schema'

export interface ConflictInfo {
  note_id: string
  local_body: string
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
}

function post(path: string, payload: unknown) {
  return apiFetch<ServerAck>(path, { method: 'POST', body: JSON.stringify(payload) })
}

function patch(path: string, payload: unknown) {
  return apiFetch<ServerAck>(path, { method: 'PATCH', body: JSON.stringify(payload) })
}

async function send(task: OutboxTask): Promise<ServerAck> {
  const payload = (task.payload ?? {}) as Record<string, unknown>
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

  for (const task of tasks) {
    if (task.failed === 1) continue
    if (task.next_at > now) continue

    try {
      const ack = await send(task)

      // 只有正文类任务才生成冲突副本——那才是会丢失文字的场景
      if (ack.conflicted && (task.kind === 'body' || task.kind === 'create')) {
        const note = await db.notes.get(task.note_id)
        if (note) result.conflicts.push({ note_id: task.note_id, local_body: note.body })
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
      const status = error instanceof ApiError ? error.status : 0

      // 401 不消耗任务：令牌修复后应能续传
      if (status === 401) {
        result.failed++
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
