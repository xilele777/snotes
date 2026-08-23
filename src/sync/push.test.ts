import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { createNote, updateBody, updateProps } from '../db/repo'
import { db } from '../db/schema'
import { pushOnce } from './push'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  apiFetch,
}))

beforeEach(async () => {
  await db.delete()
  await db.open()
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ version: 2, prop_version: 1, update_time: 999, conflicted: false })
})

describe('pushOnce', () => {
  it('消费 create 任务并调用创建端点', async () => {
    const note = await createNote('内容')

    const result = await pushOnce()

    expect(result.sent).toBe(1)
    expect(apiFetch).toHaveBeenCalledWith('/api/notes', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({ id: note.id, content: '内容' })
  })

  it('成功后删除任务并清 dirty', async () => {
    const note = await createNote('内容')

    await pushOnce()

    expect(await db.outbox.count()).toBe(0)
    expect((await db.notes.get(note.id))!.dirty).toBe('none')
  })

  it('只清掉本次任务对应的那一位 dirty', async () => {
    const note = await createNote('a')
    await pushOnce()

    // 同时改正文与属性，两条任务；只推其中一条不能把另一条的脏位一起抹掉
    await updateBody(note.id, 'b')
    await updateProps(note.id, { star: 1 })
    expect((await db.notes.get(note.id))!.dirty).toBe('both')

    await db.outbox.where('kind').equals('prop').delete()
    await pushOnce()

    // 只推了 body，prop 的脏位应当还在
    expect((await db.notes.get(note.id))!.dirty).toBe('prop')
  })

  it('body ack 同时写回 body_version——否则下轮 pull 会把刚推上去的内容再拉回来覆盖', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    await updateBody(note.id, 'b')
    apiFetch.mockResolvedValue({ version: 6, prop_version: 1, update_time: 1 })
    await pushOnce()

    expect((await db.notes.get(note.id))!.body_version).toBe(6)
  })

  it('任务发出期间被合并过（seq 变大）就不删除，保留新 payload 下轮再发', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    await updateProps(note.id, { star: 1 })
    apiFetch.mockImplementation(async () => {
      // 模拟请求在途时用户又点了一次：enqueue 合并进同一行并把 seq 递增
      await updateProps(note.id, { star: 0 })
      return { version: 1, prop_version: 2, update_time: 1 }
    })

    await pushOnce()

    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ star: 0 })
  })

  it('把服务端返回的版本号与时间写回本地', async () => {
    const note = await createNote('内容')
    apiFetch.mockResolvedValue({ id: note.id, version: 5, prop_version: 3, update_time: 12345 })

    await pushOnce()

    const updated = await db.notes.get(note.id)
    expect(updated).toMatchObject({ version: 5, prop_version: 3, update_time: 12345 })
  })

  it('body 任务走 PATCH 且带 base_version', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    await updateBody(note.id, 'b')
    await pushOnce()

    expect(apiFetch).toHaveBeenCalledWith(
      `/api/notes/${note.id}`,
      expect.objectContaining({ method: 'PATCH' })
    )
    const body = JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({ content: 'b', base_version: expect.any(Number) })
  })

  it('prop 任务只发属性字段，不含 content', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    await updateProps(note.id, { star: 1 })
    await pushOnce()

    const body = JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({ star: 1 })
    expect(body).not.toHaveProperty('content')
  })

  it('串行消费：多条任务按入队顺序依次发出', async () => {
    const a = await createNote('a')
    const b = await createNote('b')

    await pushOnce()

    const urls = apiFetch.mock.calls.map((c) => c[0])
    expect(urls).toEqual(['/api/notes', '/api/notes'])
    const ids = apiFetch.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).id
    )
    expect(ids).toEqual([a.id, b.id])
  })

  it('5xx 失败时保留任务并递增 retry', async () => {
    await createNote('a')
    apiFetch.mockRejectedValue(new ApiError(500, 'boom'))

    const result = await pushOnce()

    expect(result.failed).toBe(1)
    const task = await db.outbox.toCollection().first()
    expect(task!.retry).toBe(1)
    expect(task!.next_at).toBeGreaterThan(Date.now())
  })

  it('退避未到期的任务本轮跳过', async () => {
    await createNote('a')
    await db.outbox.toCollection().modify({ next_at: Date.now() + 60_000 })

    const result = await pushOnce()

    expect(result.sent).toBe(0)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('不可重试的 4xx 标记 failed 而不是丢弃', async () => {
    await createNote('a')
    apiFetch.mockRejectedValue(new ApiError(400, 'bad'))

    const result = await pushOnce()

    // 丢弃等于静默吞掉用户的一次写入。留在库里标记失败，界面才能提示、用户才能重试
    const task = await db.outbox.toCollection().first()
    expect(task!.failed).toBe(1)
    expect(result.failedTotal).toBe(1)
  })

  it('failed 的任务不再参与后续轮次，也不重复计入 failed', async () => {
    await createNote('a')
    apiFetch.mockRejectedValue(new ApiError(400, 'bad'))
    await pushOnce()
    apiFetch.mockClear()

    const result = await pushOnce()

    expect(apiFetch).not.toHaveBeenCalled()
    expect(result.failed).toBe(0)
    expect(result.failedTotal).toBe(1)
  })

  it('401 不消耗任务——令牌问题修复后应能续传', async () => {
    await createNote('a')
    apiFetch.mockRejectedValue(new ApiError(401, 'unauthorized'))

    await pushOnce()

    expect(await db.outbox.count()).toBe(1)
  })

  it('网络错误按可重试处理', async () => {
    await createNote('a')
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await pushOnce()

    expect(result.failed).toBe(1)
    expect(await db.outbox.count()).toBe(1)
  })

  it('一条任务失败不阻塞后续任务', async () => {
    await createNote('a')
    await createNote('b')
    apiFetch
      .mockRejectedValueOnce(new ApiError(500, 'boom'))
      .mockResolvedValueOnce({ version: 1, prop_version: 1, update_time: 1 })

    const result = await pushOnce()

    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('服务端返回 conflicted 时上报冲突信息', async () => {
    const note = await createNote('本地内容')
    await pushOnce()
    apiFetch.mockClear()

    await updateBody(note.id, '本地新内容')
    apiFetch.mockResolvedValue({ version: 9, prop_version: 1, update_time: 1, conflicted: true })

    const result = await pushOnce()

    expect(result.conflicts).toEqual([{ note_id: note.id, local_body: '本地新内容' }])
  })

  it('属性任务的 conflicted 不生成冲突副本', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    await updateProps(note.id, { star: 1 })
    apiFetch.mockResolvedValue({ version: 1, prop_version: 9, update_time: 1, conflicted: true })

    const result = await pushOnce()

    // 冲突副本是为了保住正文文字。星标被 LWW 覆盖不值得多出一条笔记
    expect(result.conflicts).toEqual([])
  })

  it('trash 与 recover 任务走各自端点', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    await db.outbox.add({
      note_id: note.id,
      kind: 'trash',
      payload: {},
      retry: 0,
      next_at: 0,
      seq: 1,
      failed: 0,
    })
    await pushOnce()

    expect(apiFetch).toHaveBeenCalledWith(
      `/api/notes/${note.id}/trash`,
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('清空回收站任务走 trash/clean', async () => {
    await db.outbox.add({
      note_id: '__trash__',
      kind: 'purge',
      payload: { scope: 'trash' },
      retry: 0,
      next_at: 0,
      seq: 1,
      failed: 0,
    })
    apiFetch.mockResolvedValue({ purged: [] })

    await pushOnce()

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/trash/clean',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('分组任务按 scope 分派到分组端点', async () => {
    await db.outbox.add({
      note_id: 'g1',
      kind: 'create',
      payload: { scope: 'group', group_id: 'g1', name: '工作', ord: 0 },
      retry: 0,
      next_at: 0,
      seq: 1,
      failed: 0,
    })
    apiFetch.mockResolvedValue({ update_time: 1 })

    await pushOnce()

    expect(apiFetch).toHaveBeenCalledWith('/api/groups', expect.objectContaining({ method: 'POST' }))
  })

  it('outbox 为空时不发任何请求', async () => {
    const result = await pushOnce()

    expect(result).toEqual({ sent: 0, failed: 0, failedTotal: 0, conflicts: [] })
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
