import { derive } from '../../shared/derive'
import type { BodiesResponse } from '../../shared/types'
import { apiFetch } from '../api/client'
import { db } from '../db/schema'

/**
 * 打开笔记时的正文版本校验（WPS 便签同款读路径）。
 *
 * 同步游标只能保证「上一轮同步时是新的」：另一台设备在这之后写的内容，要等
 * 下一轮 pull 才可见——恰好用户此刻正盯着这条笔记看。WPS 的做法是每次打开笔记
 * 都按 noteId 拉一次正文、与本地 contentVersion 比对，不同才更新渲染。这里同样：
 * 带 id 要一次正文，版本没有前进就零渲染；前进了且本地没有未确认编辑就落库。
 *
 * 请求体只有几百字节，失败静默（离线/旧服务端/401 都不影响正常使用），
 * 下一轮 pull 仍会兜底。
 */
const OPEN_REFRESH_THROTTLE_MS = 30_000
const lastRefreshAt = new Map<string, number>()
const inFlight = new Map<string, Promise<string | undefined>>()

/** 返回服务端更新的正文（已落库）；没有更新时返回 undefined。 */
export function refreshNoteBodyOnOpen(id: string): Promise<string | undefined> {
  const last = lastRefreshAt.get(id)
  // 左右方向键快速划过列表时不打请求风暴；30s 内看过的笔记下一轮 pull 会兜底
  if (last && Date.now() - last < OPEN_REFRESH_THROTTLE_MS) return Promise.resolve(undefined)
  const pending = inFlight.get(id)
  if (pending) return pending
  const task = (async () => {
    lastRefreshAt.set(id, Date.now())
    const note = await db.notes.get(id)
    if (!note) return undefined
    // 本地还有没推上去的正文：先让 push 去和服务端解冲突，此时比对没有意义
    const tasks = await db.outbox.where('note_id').equals(id).toArray()
    if (tasks.some((task) => task.kind === 'body' || task.kind === 'create')) return undefined

    const response = await apiFetch<BodiesResponse>('/api/sync/bodies', {
      method: 'POST', body: JSON.stringify({ ids: [id] }),
    })
    const remote = response.bodies.find((body) => body.note_id === id)
    if (!remote || remote.version <= note.body_version) return undefined

    // 落库前在事务里重查：请求飞行期间用户可能又开始了输入（草稿 stage 后马上
    // 会入队 body 任务）。有未确认编辑就不能覆盖，交给保存链路的冲突副本。
    let applied: string | undefined
    await db.transaction('rw', db.notes, db.bodies, db.outbox, async () => {
      const current = await db.notes.get(id)
      if (!current) return
      const pendingTasks = await db.outbox.where('note_id').equals(id).toArray()
      if (pendingTasks.some((task) => task.kind === 'body' || task.kind === 'create')) return
      if (remote.version <= current.body_version) return
      await db.bodies.put({ id, body: remote.content })
      await db.notes.update(id, { version: remote.version, body_version: remote.version, ...derive(remote.content) })
      applied = remote.content
    })
    return applied
  })().finally(() => { inFlight.delete(id) })
  inFlight.set(id, task)
  return task
}
