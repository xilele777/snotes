import { backoffDelay, isRetriableStatus } from '../../shared/backoff'
import type { OutboxTask } from '../../shared/types'
import { ApiError, apiFetch } from '../api/client'
import { db } from '../db/schema'
import { deleteHistoryIn } from '../db/history'
import { createConflictCopy } from '../db/repo'

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

/** 在同一个事务内确认 seq、写入 ACK，并删除已确认的 outbox 行。 */
async function finalizeAck(task: OutboxTask, ack: ServerAck): Promise<boolean> {
  return db.transaction('rw', db.notes, db.outbox, async () => {
    const current = task.id === undefined ? undefined : await db.outbox.get(task.id)
    // 请求在途期间如果本地又写入，mergeTask 会递增 seq。旧 ACK 只能算发送成功，
    // 不能清理新任务，也不能把新正文标记成远端版本。
    if (!current) return false
    const unchanged = current.seq === task.seq

    const note = await db.notes.get(task.note_id)
    if (note) {
      const otherTasks = await db.outbox.where('note_id').equals(task.note_id).toArray()
      const newerBody = otherTasks.some(t => (t.kind === 'body' || t.kind === 'create') && (t.id !== task.id || !unchanged))
      const newerProp = otherTasks.some(t => t.kind !== 'body' && (t.id !== task.id || !unchanged))
      const fields: Record<string, unknown> = { dirty: unchanged ? clearBit(note.dirty, task.kind) : note.dirty }
      if (newerBody) fields.dirty = newerProp ? 'both' : 'body'
      else if (newerProp) fields.dirty = 'prop'
      if (typeof ack.version === 'number') {
        fields.version = Math.max(note.version, ack.version)
        if (!newerBody && (task.kind === 'body' || task.kind === 'create')) fields.body_version = ack.version
      }
      if (typeof ack.prop_version === 'number') fields.prop_version = Math.max(note.prop_version, ack.prop_version)
      if (unchanged && !newerBody && !newerProp && typeof ack.update_time === 'number') fields.update_time = ack.update_time
      await db.notes.update(task.note_id, fields)
    }
    if (unchanged) await db.outbox.delete(task.id)
    return unchanged
  })
}

async function deleteIfCurrent(task: OutboxTask): Promise<boolean> {
  if (task.id === undefined) return false
  return db.transaction('rw', db.outbox, async () => {
    const current = await db.outbox.get(task.id)
    if (!current || current.seq !== task.seq) return false
    await db.outbox.delete(task.id)
    return true
  })
}

/** 旧请求的错误也不能把请求在途期间新合并的任务标成永久失败。 */
async function failIfCurrent(task: OutboxTask, fields: Partial<OutboxTask>) {
  if (task.id === undefined) return
  await db.transaction('rw', db.outbox, async () => {
    const current = await db.outbox.get(task.id!)
    if (current?.seq === task.seq) await db.outbox.update(task.id!, fields)
  })
}

/**
 * 并行发送上限。与拉正文的批次并发数保持一致：独立请求共享浏览器对同域的
 * 少量连接，开得再多也只是排队，还会挤占正文批次的连接。
 */
const PUSH_CONCURRENCY = 3

export async function pushOnce(): Promise<PushResult> {
  const now = Date.now()
  const result: PushResult = { sent: 0, failed: 0, failedTotal: 0, conflicts: [] }

  const tasks = await db.outbox.orderBy('id').toArray()

  // 同一条笔记（分组任务的 note_id 就是 group_id）的任务串成一条链，链内严格按
  // 入队顺序：create → body/prop/trash 的因果不能颠倒。不同链之间互不依赖，
  // 用小并发池并行——批量导入、恢复备份或重试全部时不再一条条等往返。
  const chains: OutboxTask[][] = []
  const byNote = new Map<string, OutboxTask[]>()
  for (const task of tasks) {
    let chain = byNote.get(task.note_id)
    if (!chain) { chain = []; byNote.set(task.note_id, chain); chains.push(chain) }
    chain.push(task)
  }

  // unauthorized：令牌已失效（clearToken 已发生），剩余任务注定 401，停止起链、
  // 在途请求各自收尾。reset：恢复围栏命中，必须终止整轮并在结束时向上抛出。
  let stop: 'none' | 'unauthorized' | 'reset' = 'none'
  let stopError: unknown
  // 读取走函数：stop 只在 runChain 闭包里被改写，直接读会被 TS 收窄成 'none'
  const stopState = () => stop

  async function runChain(chain: OutboxTask[]): Promise<void> {
    // create 尚未成功（本轮被退避跳过、请求失败或已标记 failed）的笔记 / 分组，
    // 它名下排在后面的 body/prop/trash… 任务这一轮一律挂起：服务端还没有这一行，
    // 发出去只会 404，而 404 路径会把任务当作「服务端已物理删除」丢弃——
    // 等 create 重试成功后，这些编辑就再也推不上去了。
    let blocked = false

    for (const task of chain) {
      if (blocked || stop !== 'none') return

      if (task.failed === 1 || task.next_at > now) {
        if (task.kind === 'create') blocked = true
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

        await finalizeAck(task, ack)
        result.sent++
      } catch (error) {
        if (task.kind === 'create') blocked = true

        const status = error instanceof ApiError ? error.status : 0
        // Recovery fencing must stop the entire round without changing task
        // state. The next preflight will reconcile before replaying any write.
        if (status === 409 && (error as ApiError).data && ((error as ApiError).data as { error?: string }).error === 'sync_reset_required') {
          stop = 'reset'
          stopError = error
          return
        }
        const failure = { last_error: `${status ? `HTTP ${status}: ` : ''}${error instanceof Error ? error.message : String(error)}`, failed_at: Date.now() }

        // 401 不消耗任务：令牌修复后应能续传。同时必须停掉其余链：
        // clearToken 已经把令牌清了，剩下每条任务再发也是注定 401。
        // 不停的话，outbox 里几百条任务就是几百个空转请求，白烧流量、还拖慢界面
        // 切回 TokenGate。停掉后这些任务原样留在库里，重新登录后的首轮继续推。
        if (status === 401) {
          result.failed++
          stop = 'unauthorized'
          return
        }

        // 服务端缺失正文目标时保留任务，供用户导出/恢复，不能静默丢掉离线编辑。
        if (status === 404 || status === 410) {
          if (status === 410) {
            await db.transaction('rw', [db.notes, db.outbox, db.history, db.knowledgeBaseNoteStates, db.meta], async () => {
              const local = await db.notes.get(task.note_id)
              const queued = await db.outbox.where('note_id').equals(task.note_id).toArray()
              if (local?.body.trim() && queued.some(row => row.kind === 'body' || row.kind === 'create')) await createConflictCopy(local, local.body)
              await db.notes.delete(task.note_id)
              await deleteHistoryIn([task.note_id])
              await db.outbox.where('note_id').equals(task.note_id).delete()
              await db.knowledgeBaseNoteStates.put({ id: task.note_id, state: 'purged' })
            })
            continue
          }
          if (task.kind === 'body') {
            await failIfCurrent(task, { failed: 1, ...failure })
            result.failed++
          } else await deleteIfCurrent(task)
          continue
        }

        // 不可重试的 4xx 标记失败留在库里。丢弃等于静默吞掉用户的一次写入，
        // 用户既看不到也救不回来。留着才能提示、才能手动重试。
        if (status >= 400 && status < 500 && !isRetriableStatus(status)) {
          await failIfCurrent(task, { failed: 1, ...failure })
          result.failed++
          continue
        }

        const retry = task.retry + 1
        await failIfCurrent(task, { retry, next_at: Date.now() + backoffDelay(retry - 1), ...failure })
        result.failed++
      }
    }
  }

  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      if (stop !== 'none') return
      const index = next++
      if (index >= chains.length) return
      await runChain(chains[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, chains.length) }, worker))

  if (stopState() === 'reset') throw stopError
  result.failedTotal = await db.outbox.where('failed').equals(1).count()
  return result
}
