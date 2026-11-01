import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { createNote, purgeNote, purgeTrash, recoverNote, trashNote, updateBody, updateProps } from '../db/repo'
import { db } from '../db/schema'
import { pushOnce } from './push'
import { pullOnce } from './pull'
import { onRemoteApplied } from './signal'

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
  it('drains in-flight uploads before exposing a local acknowledgement storage failure', async () => {
    for (let i = 0; i < 4; i++) await createNote(`note ${i}`)
    const tasks = await db.outbox.orderBy('id').toArray()
    const pending: ((value: unknown) => void)[] = []
    apiFetch.mockImplementation(() => new Promise(resolve => { pending.push(resolve) }))
    let finished = false
    const pushing = pushOnce().catch(error => { finished = true; return error })
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    const get = db.outbox.get.bind(db.outbox)
    const read = vi.spyOn(db.outbox, 'get').mockImplementation((id: unknown) => {
      if (id === tasks[0].id) return Promise.reject(new Error('local storage unavailable')) as ReturnType<typeof get>
      return get(id as number)
    })
    try {
      pending[0]({ version: 1, prop_version: 1 })
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
      expect(finished).toBe(false)
      expect(pending).toHaveLength(3)
    } finally {
      pending[1]({ version: 1, prop_version: 1 })
      pending[2]({ version: 1, prop_version: 1 })
      await pushing
      read.mockRestore()
    }
    expect(await pushing).toMatchObject({ message: 'local storage unavailable' })
    expect(apiFetch).toHaveBeenCalledTimes(3)
    expect(await db.outbox.bulkGet([tasks[1].id!, tasks[2].id!])).toEqual([undefined, undefined])
    expect(await db.outbox.get(tasks[3].id!)).toEqual(tasks[3])
  })

  it('clearing offline trash cannot replay its queued create and restore the deleted note', async () => {
    const note = await createNote('offline')
    await trashNote(note.id)
    await purgeTrash()
    const remote = new Map<string, number>()
    apiFetch.mockImplementation(async (path: string, init: RequestInit) => {
      if (path === '/api/notes') remote.set(JSON.parse(init.body as string).id, 0)
      else if (path.endsWith('/trash')) remote.set(note.id, 1)
      else if (path.endsWith('/purge')) remote.delete(note.id)
      else if (path === '/api/trash/clean') for (const [id, state] of remote) if (state === 1) remote.delete(id)
      return { version: 1, prop_version: 1, update_time: 1 }
    })
    await pushOnce()
    expect(remote.size).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/notes')).toBe(false)
  })

  it('does not send a queued body cancelled while the create ahead of it is in flight', async () => {
    const note = await createNote('original')
    await updateBody(note.id, 'cancelled edit')
    let release!: (value: unknown) => void
    apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pushing = pushOnce()
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    await purgeNote(note.id)
    release({ version: 1, prop_version: 1, update_time: 1 })
    await pushing
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect((await db.outbox.toArray()).map(task => task.kind)).toEqual(['purge'])
    await pushOnce()
    expect(apiFetch.mock.calls[1][0]).toBe(`/api/notes/${note.id}/purge`)
  })

  it('keeps a newer queued edit when the round still holds an older body snapshot', async () => {
    const note = await createNote('original')
    apiFetch.mockResolvedValue({ version: 1, prop_version: 1, update_time: 1 })
    await pushOnce()
    await updateProps(note.id, { top: 1 })
    await updateBody(note.id, 'queued before sync')
    apiFetch.mockClear()
    let release!: (value: unknown) => void
    apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pushing = pushOnce()
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    await updateBody(note.id, 'newest edit')
    release({ version: 1, prop_version: 2, update_time: 2 })
    await pushing
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect((await db.outbox.toArray())[0].payload).toMatchObject({ content: 'newest edit' })
    await pushOnce()
    expect(JSON.parse(apiFetch.mock.calls[1][1].body as string)).toMatchObject({ content: 'newest edit', base_version: 1 })
  })

  it.each(['body', 'prop', 'trash', 'recover'] as const)('%s acknowledgement does not hide remote changes to other properties', async kind => {
    const note = await createNote('original')
    apiFetch.mockResolvedValue({ version: 1, prop_version: 1, update_time: 1 })
    await pushOnce()
    if (kind === 'body') await updateBody(note.id, 'edited')
    else if (kind === 'prop') await updateProps(note.id, { top: 1 })
    else if (kind === 'trash') await trashNote(note.id)
    else await recoverNote(note.id)
    const version = kind === 'body' ? 2 : 1
    apiFetch.mockResolvedValue({ version, prop_version: 3, update_time: 3 })
    await pushOnce()
    const remote = { ...(await db.notes.get(note.id))!, version, prop_version: 3, star: 1, update_time: 3 }
    apiFetch.mockResolvedValue({ notes: [remote], groups: [], server_time: 3, next_cursor: null })
    await pullOnce()
    expect(await db.notes.get(note.id)).toMatchObject({ star: 1, prop_version: 3 })
  })

  it('a property acknowledgement cannot advance the base for an unseen remote body', async () => {
    const note = await createNote('original')
    apiFetch.mockResolvedValue({ version: 1, prop_version: 1, update_time: 1 })
    await pushOnce()
    await updateProps(note.id, { top: 1 })
    await updateBody(note.id, 'local edit')
    apiFetch.mockImplementation(async (_path: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string)
      if (!('content' in payload)) return { version: 2, prop_version: 2, update_time: 2 }
      const conflicted = payload.base_version < 2
      return { version: 3, prop_version: 2, update_time: 3, conflicted, ...(conflicted ? { previous_content: 'other device edit' } : {}) }
    })
    expect((await pushOnce()).conflicts).toEqual([{ note_id: note.id, body: 'other device edit' }])
  })

  it('a replayed creation downloads changes made by another device after the original create', async () => {
    const note = await createNote('original create')
    apiFetch.mockResolvedValue({ version: 3, prop_version: 3, update_time: 3, replayed: true })
    await pushOnce()
    apiFetch.mockImplementation(async (path: string) => path === '/api/sync/bodies'
      ? { bodies: [{ note_id: note.id, content: 'other device edit', version: 3 }] }
      : { notes: [{ ...note, version: 3, prop_version: 3, star: 1 }], groups: [], server_time: 3, next_cursor: null })
    await pullOnce()
    expect((await db.bodies.get(note.id))?.body).toBe('other device edit')
    expect(await db.notes.get(note.id)).toMatchObject({ star: 1, body_version: 3, prop_version: 3 })
  })

  it.each([0, 408, 429, 503])('stops scheduling after transient status %s and keeps unsent work untouched', async status => {
    for (let i = 0; i < 10; i++) await createNote(`pending ${i}`)
    const before = await db.outbox.toArray()
    const pending: { resolve: (ack: unknown) => void; reject: (error: Error) => void }[] = []
    apiFetch.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }))
    let finished = false
    const pushing = pushOnce().then(result => { finished = true; return result })
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    pending[0].reject(status ? new ApiError(status, 'unavailable') : new TypeError('offline'))
    await vi.waitFor(async () => expect((await db.outbox.get(before[0].id!))?.retry).toBe(1))
    expect(finished).toBe(false)
    pending[1].resolve({ version: 1, prop_version: 1 })
    pending[2].resolve({ version: 1, prop_version: 1 })
    expect(await pushing).toMatchObject({ sent: 2, failed: 1, interrupted: true })
    expect(apiFetch).toHaveBeenCalledTimes(3)
    expect(await db.outbox.bulkGet(before.slice(3).map(t => t.id!))).toEqual(before.slice(3))
  })
  it('stops a fenced recovery write without failing or consuming pending work', async () => {
    await createNote('恢复前本地输入')
    const before = await db.outbox.toArray()
    apiFetch.mockRejectedValue(new ApiError(409, 'reset', { error: 'sync_reset_required' }))
    await expect(pushOnce()).rejects.toThrow('reset')
    expect(await db.outbox.toArray()).toEqual(before)
  })
  it('永久删除拒绝的迟到创建先留恢复副本，再清除原任务与历史', async () => {
    const note = await createNote('迟到的正文')
    await db.history.add({ note_id: note.id, body: '旧正文', time: 1 })
    apiFetch.mockRejectedValue(new ApiError(410, 'permanently_deleted'))
    const result = await pushOnce()
    expect(result.failedTotal).toBe(0)
    expect(await db.outbox.count()).toBe(1)
    expect((await db.bodies.toArray())[0].body).toContain('迟到的正文')
    expect(await db.notes.get(note.id)).toBeUndefined()
    expect(await db.history.count()).toBe(0)
    expect((await db.knowledgeBaseNoteStates.get(note.id))?.state).toBe('purged')
  })
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

  it('ACK 返回期间的新正文任务不会被旧 ACK 删除', async () => {
    const note = await createNote('初稿')
    let resolve!: (value: unknown) => void
    apiFetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pushing = pushOnce()
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    await updateBody(note.id, 'ACK 期间的新正文')
    resolve({ version: 2, prop_version: 1, update_time: 2 })
    await pushing

    const task = await db.outbox.where('kind').equals('body').first()
    expect(task).toBeDefined()
    expect((await db.bodies.get(note.id))!.body).toBe('ACK 期间的新正文')
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

  it('create 成功后紧接着的 body 任务使用最新版本，避免自冲突', async () => {
    const note = await createNote('初始')
    // 编辑发生在 create 请求之前，因此旧任务里会留下 base_version=0。
    await updateBody(note.id, '剪切后粘贴的内容')

    apiFetch.mockImplementation(async (path: string, init: RequestInit) => {
      if (path === '/api/notes' && init.method === 'POST') {
        return { version: 1, prop_version: 1, update_time: 1, conflicted: false }
      }

      const body = JSON.parse(init.body as string) as { base_version: number }
      return {
        version: 2,
        prop_version: 1,
        update_time: 2,
        conflicted: body.base_version < 1,
      }
    })

    const result = await pushOnce()

    expect(result.conflicts).toEqual([])
    const body = JSON.parse((apiFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.base_version).toBe(1)
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

  it('401 短路整轮——clearToken 后剩余任务注定 401，停止起链不空转', async () => {
    await createNote('a')
    await createNote('b')
    apiFetch.mockRejectedValue(new ApiError(401, 'unauthorized'))

    const result = await pushOnce()

    // Only already-started requests may receive 401; tasks still being checked
    // in IndexedDB should stop as soon as the first rejection is known.
    expect(apiFetch.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(apiFetch.mock.calls.length).toBeLessThanOrEqual(2)
    expect(result.failed).toBe(apiFetch.mock.calls.length)
    expect(await db.outbox.count()).toBe(2)
  })

  it('不同笔记的链并行发送，同一笔记的任务仍按序串行', async () => {
    for (let i = 0; i < 5; i++) await createNote(`n${i}`)
    let inFlight = 0
    let maxInFlight = 0
    const gates: Array<() => void> = []
    apiFetch.mockImplementation(() => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise(resolve => {
        gates.push(() => { inFlight--; resolve({ version: 1, prop_version: 1, update_time: 1, conflicted: false }) })
      })
    })

    const pushing = pushOnce()
    // 池大小 3：先起 3 条链，另外 2 条在排队
    await vi.waitFor(() => expect(gates).toHaveLength(3))
    expect(maxInFlight).toBe(3)
    gates.splice(0).forEach(gate => gate())

    // 放行后剩下的链继续起跑并发完
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates.splice(0).forEach(gate => gate())
    const result = await pushing

    expect(result.sent).toBe(5)
    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(await db.outbox.count()).toBe(0)
  })

  it('404 not_found 保留离线正文任务供人工恢复', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    // 服务端那一行已被彻底删除（如过了墓碑保留期），再 PATCH 必然 404
    await updateBody(note.id, '又编辑了一版')
    apiFetch.mockRejectedValue(new ApiError(404, 'not_found'))

    const result = await pushOnce()

    expect(await db.outbox.count()).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failedTotal).toBe(1)
    expect((await db.outbox.toArray())[0].payload).toMatchObject({ content: '又编辑了一版' })
  })

  it('404 丢弃也尊重 seq——请求在途时被合并就不删，新 payload 下轮再发', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    await updateProps(note.id, { star: 1 })
    apiFetch.mockImplementation(async () => {
      await updateProps(note.id, { star: 0 }) // 在途再次编辑，enqueue 合并并递增 seq
      throw new ApiError(404, 'not_found')
    })

    await pushOnce()

    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ star: 0 })
  })

  it('网络错误按可重试处理', async () => {
    await createNote('a')
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await pushOnce()

    expect(result.failed).toBe(1)
    expect(await db.outbox.count()).toBe(1)
  })

  it('一条在途任务失败时，其他在途成功仍会确认', async () => {
    await createNote('a')
    await createNote('b')
    let rejectFirst!: (error: Error) => void
    apiFetch
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
      .mockResolvedValueOnce({ version: 1, prop_version: 1, update_time: 1 })

    const pushing = pushOnce()
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    rejectFirst(new ApiError(500, 'boom'))
    const result = await pushing

    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
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

describe('pushOnce 冲突副本取被覆盖的服务端正文', () => {
  it('persists and announces a conflict before another upload forces a recovery reset', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    await pushOnce()
    await updateBody(a.id, 'new a')
    await updateBody(b.id, 'new b')
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    apiFetch.mockImplementation((path: string) => new Promise((resolve, reject) => { pending.set(path, { resolve, reject }) }))
    const listener = vi.fn()
    const off = onRemoteApplied(listener)
    const pushing = pushOnce()
    const rejected = expect(pushing).rejects.toThrow('reset')
    await vi.waitFor(() => expect(pending.size).toBe(2))
    pending.get(`/api/notes/${a.id}`)!.resolve({ version: 3, prop_version: 1, conflicted: true, previous_content: 'remote a' })
    pending.get(`/api/notes/${b.id}`)!.reject(new ApiError(409, 'reset', { error: 'sync_reset_required' }))
    try {
      await rejected
      const copies = (await db.notes.toArray()).filter(note => note.id !== a.id && note.id !== b.id)
      expect(copies).toHaveLength(1)
      expect((await db.bodies.get(copies[0].id))?.body).toContain('remote a')
      expect(await db.outbox.where('note_id').equals(copies[0].id).count()).toBe(1)
      expect(listener).toHaveBeenCalled()
    } finally { off() }
  })

  it('rolls back acknowledgement when saving its conflict copy fails', async () => {
    const note = await createNote('original')
    await pushOnce()
    await updateBody(note.id, 'edited')
    apiFetch.mockResolvedValue({ version: 3, prop_version: 1, conflicted: true, previous_content: 'remote text' })
    const write = vi.spyOn(db.bodies, 'put').mockRejectedValueOnce(new Error('disk full'))
    try {
      expect((await pushOnce()).failed).toBe(1)
      expect(await db.notes.count()).toBe(1)
      expect(await db.outbox.where('[note_id+kind]').equals([note.id, 'body']).count()).toBe(1)
      expect((await db.notes.get(note.id))?.body_version).not.toBe(3)
    } finally { write.mockRestore() }
  })

  it('saves an acknowledged conflict even if its original task was purged in flight', async () => {
    const note = await createNote('original')
    await pushOnce()
    await updateBody(note.id, 'edited')
    apiFetch.mockImplementationOnce(async () => {
      await purgeNote(note.id)
      return { version: 3, prop_version: 1, conflicted: true, previous_content: 'remote text' }
    })
    await pushOnce()
    expect(await db.notes.get(note.id)).toBeUndefined()
    expect((await db.bodies.toArray()).some(row => row.body.includes('remote text'))).toBe(true)
    expect((await db.outbox.where('note_id').equals(note.id).first())?.kind).toBe('purge')
  })

  it('服务端返回 conflicted 时，上报的是随响应带回的被覆盖正文', async () => {
    const note = await createNote('本地内容')
    await pushOnce()
    apiFetch.mockClear()

    await updateBody(note.id, '本地新内容')
    apiFetch.mockResolvedValue({
      version: 9,
      prop_version: 1,
      update_time: 1,
      conflicted: true,
      previous_content: '另一台设备的内容',
    })

    const result = await pushOnce()

    // 后写者胜：本地内容已经是服务端上的正文，再存一份只会得到两条一样的笔记，
    // 真正会丢的是被覆盖的那一版
    expect(result.conflicts).toEqual([{ note_id: note.id, body: '另一台设备的内容' }])
  })

  it('conflicted 但没带 previous_content（如只有属性冲突）时不生成副本', async () => {
    const note = await createNote('a')
    await pushOnce()
    apiFetch.mockClear()

    await updateProps(note.id, { star: 1 })
    apiFetch.mockResolvedValue({ version: 1, prop_version: 9, update_time: 1, conflicted: true })

    const result = await pushOnce()

    // 冲突副本是为了保住正文文字。星标被 LWW 覆盖不值得多出一条笔记
    expect(result.conflicts).toEqual([])
  })

  it('请求在途期间再次编辑时，副本仍取被覆盖的服务端正文，新编辑留在 outbox', async () => {
    const note = await createNote('a')
    await pushOnce()
    await updateBody(note.id, '本次发出的版本')

    apiFetch.mockImplementation(async () => {
      // 模拟网络请求尚未返回时，用户又完成一次剪切/粘贴。
      await updateBody(note.id, '请求在途期间的新版本')
      return { version: 9, prop_version: 1, update_time: 1, conflicted: true, previous_content: '远端正文' }
    })

    const result = await pushOnce()

    expect(result.conflicts).toEqual([{ note_id: note.id, body: '远端正文' }])
    const pending = await db.outbox.where('[note_id+kind]').equals([note.id, 'body']).first()
    expect((pending!.payload as { content: string }).content).toBe('请求在途期间的新版本')
  })
})

describe('pushOnce 在 create 未成功时挂起同一笔记的后续任务', () => {
  it.each([400, 503])('旧请求 %s 错误不能标记或退避在途期间合并的新任务', async status => {
    const note = await createNote('original')
    await pushOnce()
    await updateBody(note.id, 'first')
    apiFetch.mockImplementationOnce(async () => {
      await updateBody(note.id, 'latest')
      throw new ApiError(status, 'request failed')
    })
    await pushOnce()
    const pending = await db.outbox.where('[note_id+kind]').equals([note.id, 'body']).first()
    expect(pending).toMatchObject({ failed: 0, retry: 0, next_at: 0, payload: { content: 'latest' } })
  })
  it('create 暂时失败时 body 任务本轮不发，create 成功后再补发', async () => {
    const note = await createNote('初始')
    await updateBody(note.id, '后续编辑')

    // 创建请求 503。若正文任务照常发出，服务端因笔记不存在回 404，
    // 404 路径会把它当作「已物理删除」丢弃，create 重试成功后这次编辑就再也推不上去
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/notes') throw new ApiError(503, 'unavailable')
      throw new ApiError(404, 'not_found')
    })
    await pushOnce()

    const kinds = (await db.outbox.where('note_id').equals(note.id).toArray()).map((t) => t.kind).sort()
    expect(kinds).toEqual(['body', 'create'])
    expect(apiFetch).toHaveBeenCalledTimes(1)

    await db.outbox.toCollection().modify({ next_at: 0 })
    apiFetch.mockResolvedValue({ version: 1, prop_version: 1, update_time: 1, conflicted: false })
    await pushOnce()

    expect(await db.outbox.count()).toBe(0)
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual(['/api/notes', '/api/notes', `/api/notes/${note.id}`])
  })

  it('create 仍在退避期时，后续任务同样等待', async () => {
    const note = await createNote('初始')
    await updateBody(note.id, '后续编辑')
    await db.outbox.where('kind').equals('create').modify({ retry: 1, next_at: Date.now() + 60_000 })

    const result = await pushOnce()

    expect(apiFetch).not.toHaveBeenCalled()
    expect(result.sent).toBe(0)
    expect(await db.outbox.where('note_id').equals(note.id).count()).toBe(2)
  })

  it('create 已被标记失败时，后续任务不发也不被丢弃', async () => {
    const note = await createNote('初始')
    await updateBody(note.id, '后续编辑')
    await db.outbox.where('kind').equals('create').modify({ failed: 1 })

    await pushOnce()

    expect(apiFetch).not.toHaveBeenCalled()
    expect(await db.outbox.where('note_id').equals(note.id).count()).toBe(2)
  })

  it('一条笔记创建失败的业务错误不影响其他笔记', async () => {
    const a = await createNote('a')
    await updateBody(a.id, 'a2')
    const b = await createNote('b')

    apiFetch.mockImplementation(async (path: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { id?: string }
      if (path === '/api/notes' && body.id === a.id) throw new ApiError(400, 'invalid_body')
      return { version: 1, prop_version: 1, update_time: 1, conflicted: false }
    })

    const result = await pushOnce()

    expect(result.sent).toBe(1)
    expect(await db.outbox.where('note_id').equals(b.id).count()).toBe(0)
    expect(await db.outbox.where('note_id').equals(a.id).count()).toBe(2)
  })
})
