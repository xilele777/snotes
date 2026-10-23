import type { OpensSyncRequest, OpensSyncResponse } from '../../shared/types'
import { apiFetch } from '../api/client'
import { hasToken } from '../api/token'
import { getMeta, setMeta } from '../db/repo'
import { db } from '../db/schema'

export const OPENS_THROTTLE_MS = 60_000
/**
 * 一轮点名查询的条数上限。服务端把 want 展开成 SQL 占位符，D1 单条查询最多
 * 100 个绑定参数，两边用同一个数；问不完的下次同步继续（状态是「还不知道」，
 * 不会丢）。
 */
export const MAX_WANT = 90
const DEVICE_ID_KEY = 'device_id'
const CURSOR_KEY = 'opens_cursor'
const DIRTY_KEY = 'opens_dirty'
/**
 * 还没问过服务端「其它设备聚合值」的笔记 id 队列（meta 表）。
 *
 * 旧实现每轮同步都 db.notes.toArray() 全表扫一遍找 open_others 未知的笔记，
 * 笔记越多、正文越大越慢——正文内联在 notes 表里，等于每 30 秒把全部笔记
 * 内容克隆一遍。改为增量维护：插入笔记时入队，服务端点名回答后出队，
 * 本地已删除的 id 在问到时顺手丢弃。
 */
const UNKNOWN_KEY = 'opens_unknown'

let timer: ReturnType<typeof setTimeout> | undefined
let lastStarted: number | null = null
let inFlight: Promise<void> | null = null

async function deviceId(): Promise<string> {
  let id = await getMeta<string>(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    await setMeta(DEVICE_ID_KEY, id)
  }
  return id
}

/**
 * 还没拿到「其它设备聚合值」的笔记（open_others 仍是 undefined）。
 *
 * 增量游标只能带回「上次同步之后变过的」聚合行：一条笔记在本设备第一次见到时
 * （刚 pull 下来、或刚从备份导入），别的设备可能很久以前就打开过它，那一行的
 * update_time 远在 since 之前，增量查询永远不会返回它——不点名的话这些笔记的
 * open_others 就一直是 0，换台设备看统计「打开次数」直接归零。所以维护点名队列。
 */
/** 事务内部用：把新出现的笔记 id 追加进点名队列（幂等）。调用方的 db.transaction 必须包含 db.meta。 */
export async function enqueueOpensUnknownIn(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const queue = ((await db.meta.get(UNKNOWN_KEY))?.value as string[] | undefined) ?? []
  const known = new Set(queue)
  const added = ids.filter((id) => !known.has(id))
  if (added.length === 0) return
  await db.meta.put({ key: UNKNOWN_KEY, value: [...queue, ...added] })
}

/** 队列尚未建立（升级到本版本前创建的旧笔记）时做一次性回填，之后永不再全表扫。 */
async function seedUnknownQueueOnce(): Promise<string[]> {
  const existing = (await db.meta.get(UNKNOWN_KEY))?.value as string[] | undefined
  if (existing) return existing
  const all = await db.notes.toArray()
  const seeded = all.filter((note) => note.invalid !== 2 && note.open_others === undefined).map((note) => note.id).sort()
  // 回填扫描期间可能有新笔记并发入队：事务内重读并合并，不能整行覆盖。
  return db.transaction('rw', db.meta, async () => {
    const again = ((await db.meta.get(UNKNOWN_KEY))?.value as string[] | undefined) ?? []
    const merged = [...new Set([...again, ...seeded])]
    await db.meta.put({ key: UNKNOWN_KEY, value: merged })
    return merged
  })
}

/**
 * 从队首取一批仍存在的 id。用主键查询只取 key 不克隆正文；已被本地删除的
 * 笔记 id 就此丢弃（墓碑/彻底删除后问聚合值已无意义）。
 */
async function nextWant(queue: string[]): Promise<{ want: string[]; dropped: string[] }> {
  const window = queue.slice(0, MAX_WANT + 8)
  if (window.length === 0) return { want: [], dropped: [] }
  const existing = new Set(await db.notes.where('id').anyOf(window).primaryKeys())
  const kept = window.filter((id) => existing.has(id))
  return { want: kept.slice(0, MAX_WANT), dropped: window.filter((id) => !existing.has(id)) }
}

/** 上报本设备累积值，同时拉取其它设备聚合值。 */
export async function syncOpens(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const [id, since, dirty, queue] = await Promise.all([
      deviceId(),
      getMeta<number>(CURSOR_KEY),
      getMeta<string[]>(DIRTY_KEY),
      seedUnknownQueueOnce(),
    ])
    const { want, dropped } = await nextWant(queue)
    const snapshot = [...new Set(dirty ?? [])]
    const rows = await db.notes.bulkGet(snapshot)
    const items = rows.flatMap((note) => note ? [{
      note_id: note.id,
      count: note.open_count ?? 0,
      last_open_time: note.last_open_time ?? 0,
    }] : [])
    const request: OpensSyncRequest = { device_id: id, since: since ?? 0, items, want }
    const response = await apiFetch<OpensSyncResponse>('/api/notes/opens', {
      method: 'POST', body: JSON.stringify(request),
    })

    await db.transaction('rw', db.notes, db.meta, async () => {
      // 只认服务端明确回答过的笔记：没回的一律保持「还不知道」，下一轮继续点名。
      // 这样面对不认识 want 的旧服务端也不会把聚合值错误地写成 0。
      for (const open of response.opens) {
        const note = await db.notes.get(open.note_id)
        if (note) await db.notes.update(open.note_id, {
          open_others: open.others_count,
          open_others_time: open.others_last_open_time,
        })
      }
      // 只清本次快照：请求飞行期间产生的新增打开仍留在 dirty 中。
      const current = (await db.meta.get(DIRTY_KEY))?.value as string[] | undefined
      const sent = new Set(snapshot)
      await db.meta.put({ key: DIRTY_KEY, value: (current ?? []).filter((noteId) => !sent.has(noteId)) })
      await db.meta.put({ key: CURSOR_KEY, value: response.server_time })
      // 队列与请求前快照可能已并发变化（插入/合并），事务内重读后按差集出队。
      const answered = new Set(response.opens.map((open) => open.note_id))
      const latest = ((await db.meta.get(UNKNOWN_KEY))?.value as string[] | undefined) ?? queue
      const remove = new Set([...answered, ...dropped])
      const remaining = latest.filter((noteId) => !remove.has(noteId))
      if (remaining.length !== latest.length) await db.meta.put({ key: UNKNOWN_KEY, value: remaining })
    })
  })().finally(() => { inFlight = null })
  return inFlight
}

export function scheduleOpensSync(): void {
  // 未登录时只保留 dirty；令牌可用后由同步引擎的首轮/轮询发送。
  if (!hasToken.value) return
  const delay = lastStarted === null ? 0 : Math.max(0, OPENS_THROTTLE_MS - (Date.now() - lastStarted))
  if (timer !== undefined) return
  timer = setTimeout(() => {
    timer = undefined
    lastStarted = Date.now()
    // 打开统计不影响正文同步；后台失败保留 dirty，留给后续轮询重试。
    void syncOpens().catch(() => undefined)
  }, delay)
}

export async function flushOpensSync(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  lastStarted = Date.now()
  await syncOpens()
}
