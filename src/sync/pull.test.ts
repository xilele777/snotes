import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalNoteWithBody, NoteMeta, PullResponse } from '../../shared/types'
import { ApiError } from '../api/client'
import { createNote, getMeta, setMeta, updateBody } from '../db/repo'
import { db } from '../db/schema'
import { SYNC_CURSOR_KEY, pullOnce } from './pull'
import { onRemoteApplied } from './signal'
/** 拆表后的种子辅助：元数据入 notes 行，正文入 bodies 行 */
async function seedLocal(note: LocalNoteWithBody) {
  const { body, ...row } = note
  await db.notes.add(row)
  await db.bodies.put({ id: note.id, body })
}

const getBody = async (id: string) => (await db.bodies.get(id))?.body


const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  apiFetch,
}))

beforeEach(async () => {
  await db.delete()
  await db.open()
  apiFetch.mockReset()
})

const meta = (over: Partial<NoteMeta> = {}): NoteMeta => ({
  id: 'r1',
  group_id: null,
  title: '远端标题',
  summary: '远端摘要',
  thumbnail: null,
  version: 1,
  prop_version: 1,
  star: 0,
  top: 0,
  skin_color: null,
  invalid: 0,
  create_time: 1,
  update_time: 100,
  ...over,
})

const page = (over: Partial<PullResponse> = {}): PullResponse => ({
  notes: [],
  groups: [],
  server_time: 5000,
  next_cursor: null,
  ...over,
})

function mockPull(...responses: PullResponse[]) {
  apiFetch.mockImplementation((path: string, options: RequestInit) => {
    if (path === '/api/sync/checkpoint') return Promise.resolve({ valid: true })
    if (path === '/api/sync/bodies') return Promise.resolve({ bodies: (JSON.parse(options.body as string).ids as string[]).map(id => ({ note_id: id, content: '远端正文', version: 1 })) })
    return Promise.resolve(responses.shift() ?? page())
  })
}

describe('pullOnce', () => {
  it('a changing full inventory cannot remove local records or advance the receipt', async () => {
    await seedLocal({ ...meta({ id: 'gone' }), body: '保留正文', body_version: 1, dirty: 'none' })
    await setMeta(SYNC_CURSOR_KEY, 999)
    apiFetch.mockResolvedValueOnce(page({ checkpoint: 'new' })).mockResolvedValueOnce({ valid: false })
    await expect(pullOnce(true)).rejects.toThrow('远端内容发生变化')
    expect(await db.notes.get('gone')).toBeDefined()
    expect(await getMeta(SYNC_CURSOR_KEY)).toBe(999)
  })
  it('confirmed server tombstones do not recreate already-deleted text during reconciliation', async () => {
    await seedLocal({ ...meta(), body: '已删除正文', body_version: 1, dirty: 'none' })
    mockPull(page({ notes: [meta({ invalid: 2 })] }))
    await pullOnce(true)
    expect(await db.notes.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
  it('full reconciliation recovers missing confirmed text but keeps unsent local creations', async () => {
    await seedLocal({ ...meta({ id: 'gone' }), body: '离线旧正文', body_version: 1, dirty: 'none' })
    const unsent = await createNote('本机新建')
    mockPull(page({ checkpoint: 'new-receipt' }))
    await pullOnce(true)
    expect(await db.notes.get('gone')).toBeUndefined()
    expect(await db.notes.get(unsent.id)).toBeDefined()
    expect((await db.bodies.toArray()).some(row => row.body.includes('离线旧正文'))).toBe(true)
    expect(await getMeta('sync_checkpoint')).toBe('new-receipt')
  })
  it('full reconciliation accepts rolled-back versions and retains the previous text in history', async () => {
    await seedLocal({ ...meta({ version: 9, prop_version: 9 }), body: '备份之后写的正文', body_version: 9, dirty: 'none' })
    mockPull(page({ notes: [meta({ version: 1 })] }))
    await pullOnce(true)
    expect(await db.notes.get('r1')).toMatchObject({ body_version: 1, version: 1, prop_version: 1 })
    expect(await getBody('r1')).toBe('远端正文')
    expect((await db.history.toArray()).some(row => row.body === '备份之后写的正文')).toBe(true)
  })
  it('an interrupted full inventory never removes missing local rows or advances its receipt', async () => {
    await seedLocal({ ...meta({ id: 'gone' }), body: '保留正文', body_version: 1, dirty: 'none' })
    await setMeta(SYNC_CURSOR_KEY, 999)
    await setMeta('sync_checkpoint', 'previous')
    apiFetch.mockResolvedValueOnce(page({ next_cursor: 'next' })).mockRejectedValueOnce(new Error('offline'))
    await expect(pullOnce(true)).rejects.toThrow('offline')
    expect(await db.notes.get('gone')).toBeDefined()
    expect(await getMeta(SYNC_CURSOR_KEY)).toBe(999)
    expect(await getMeta('sync_checkpoint')).toBe('previous')
  })
  it('a reset response restarts from zero and replaces the receipt only on success', async () => {
    await setMeta(SYNC_CURSOR_KEY, 999)
    apiFetch.mockRejectedValueOnce(new ApiError(409, 'reset', { error: 'sync_reset_required' }))
      .mockResolvedValueOnce(page({ checkpoint: 'new' }))
      .mockResolvedValueOnce({ valid: true })
    await pullOnce()
    expect(JSON.parse(apiFetch.mock.calls[1][1].body).since).toBe(0)
    expect(await getMeta('sync_checkpoint')).toBe('new')
  })
  it('full reconciliation protects input typed while body download is in flight', async () => {
    await seedLocal({ ...meta({ version: 9 }), body: '旧正文', body_version: 9, dirty: 'none' })
    apiFetch.mockImplementation(async path => {
      if (path === '/api/sync/bodies') {
        await updateBody('r1', '下载期间输入')
        return { bodies: [{ note_id: 'r1', content: '远端正文', version: 1 }] }
      }
      return page({ notes: [meta()] })
    })
    await pullOnce(true)
    expect(await db.notes.get('r1')).toMatchObject({ version: 0 })
    expect(await getBody('r1')).toBe('下载期间输入')
    expect(await db.outbox.count()).toBe(1)
  })
  it('首次拉取用 since=0', async () => {
    mockPull(page())

    await pullOnce()

    const body = JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.since).toBe(0)
  })

  it('插入远端新笔记并拉取正文', async () => {
    mockPull(page({ notes: [meta()] }))

    const result = await pullOnce()

    expect(result.applied).toBe(1)
    const local = await db.notes.get('r1')
    // 标题摘要随正文重新派生，夹具里 meta 的「远端标题」不再决定本地标题
    expect(local).toMatchObject({ title: '远端正文', dirty: 'none' })
    expect(await getBody('r1')).toBe('远端正文')
  })

  it('成功后把游标推进到首页的 server_time', async () => {
    mockPull(page({ notes: [meta()], server_time: 8888 }))

    await pullOnce()

    expect(await getMeta<number>(SYNC_CURSOR_KEY)).toBe(8888)
  })

  it('第二次拉取用上次的 server_time 作为 since', async () => {
    mockPull(page({ server_time: 8888 }))
    await pullOnce()

    apiFetch.mockClear()
    mockPull(page())
    await pullOnce()

    const body = JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.since).toBe(8888)
  })

  it('游标取服务端时间，绝不用本地时钟', async () => {
    const localNow = Date.now()
    mockPull(page({ server_time: 1 }))

    await pullOnce()

    const cursor = await getMeta<number>(SYNC_CURSOR_KEY)
    expect(cursor).toBe(1)
    expect(cursor).not.toBe(localNow)
  })

  it('逐页拉取直到 next_cursor 为 null', async () => {
    mockPull(
      page({ notes: [meta({ id: 'a' })], next_cursor: 'c1' }),
      page({ notes: [meta({ id: 'b' })], next_cursor: 'c2' }),
      page({ notes: [meta({ id: 'c' })], next_cursor: null })
    )

    const result = await pullOnce()

    expect(result.pages).toBe(3)
    expect(await db.notes.count()).toBe(3)
  })

  it('后续页把 cursor 带回服务端', async () => {
    mockPull(page({ next_cursor: 'CURSOR-1' }), page({ next_cursor: null }))

    await pullOnce()

    const second = JSON.parse((apiFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(second.cursor).toBe('CURSOR-1')
  })

  it('远端 prop_version 更高则只更新属性，不动本地正文', async () => {
    await seedLocal({
      ...meta(),
      body: '本地正文',
      body_version: 1,
      dirty: 'none',
    })
    mockPull(page({ notes: [meta({ prop_version: 5, star: 1 })] }))

    await pullOnce()

    const local = await db.notes.get('r1')
    expect(local).toMatchObject({ star: 1, prop_version: 5 })
    expect(await getBody('r1')).toBe('本地正文')
  })

  it('版本不高于本地时完全忽略——重复 pull 幂等', async () => {
    mockPull(page({ notes: [meta()] }))
    await pullOnce()

    apiFetch.mockClear()
    mockPull(page({ notes: [meta()] }))
    const result = await pullOnce()

    expect(result.applied).toBe(0)
    expect(apiFetch).not.toHaveBeenCalledWith('/api/sync/bodies', expect.anything())
  })

  it('正文按 50 条一批拉取', async () => {
    const notes = Array.from({ length: 120 }, (_, i) => meta({ id: `n${i}` }))
    apiFetch.mockImplementation((path: string, options: RequestInit) => {
      if (path === '/api/sync/bodies') return Promise.resolve({ bodies: (JSON.parse(options.body as string).ids as string[]).map(id => ({ note_id: id, content: '正文', version: 1 })) })
      return Promise.resolve(page({ notes }))
    })

    await pullOnce()

    const bodyCalls = apiFetch.mock.calls.filter((c) => c[0] === '/api/sync/bodies')
    expect(bodyCalls).toHaveLength(3)
    expect(JSON.parse((bodyCalls[0][1] as RequestInit).body as string).ids).toHaveLength(50)
    expect(JSON.parse((bodyCalls[2][1] as RequestInit).body as string).ids).toHaveLength(20)
  })

  it('分组一并写入本地', async () => {
    mockPull(
      page({
        groups: [{ group_id: 'g1', name: '工作', ord: 0, color: null, invalid: 0, update_time: 1 }],
      })
    )

    await pullOnce()

    expect(await db.groups.get('g1')).toMatchObject({ name: '工作' })
  })

  it('任一页失败则整轮不推进游标', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/sync/bodies') return Promise.resolve({ bodies: [] })
      return apiFetch.mock.calls.filter((c) => c[0] === '/api/sync/pull').length === 1
        ? Promise.resolve(page({ notes: [meta()], next_cursor: 'c1' }))
        : Promise.reject(new ApiError(500, 'boom'))
    })

    await expect(pullOnce()).rejects.toBeInstanceOf(ApiError)
    expect(await getMeta<number>(SYNC_CURSOR_KEY)).toBeUndefined()
  })

  it('正文批次失败则整轮不推进游标', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/sync/bodies') return Promise.reject(new ApiError(500, 'boom'))
      return Promise.resolve(page({ notes: [meta()], server_time: 999 }))
    })

    await expect(pullOnce()).rejects.toBeInstanceOf(ApiError)
    expect(await getMeta<number>(SYNC_CURSOR_KEY)).toBeUndefined()
  })
  it('正文批次缺项也不能推进游标，后续同步仍会重试缺失正文', async () => {
    await setMeta(SYNC_CURSOR_KEY, 10)
    apiFetch.mockImplementation(async (path: string) => path === '/api/sync/bodies' ? { bodies: [] } : page({ notes: [meta()] }))
    await expect(pullOnce()).rejects.toThrow('部分正文尚不可用')
    expect(await getMeta(SYNC_CURSOR_KEY)).toBe(10)
    expect((await db.notes.get('r1'))?.body_version).toBe(0)
  })

  it('本地有未推送修改时，远端旧版本不会覆盖它', async () => {
    await seedLocal({
      ...meta({ version: 9, prop_version: 9 }),
      title: '本地较新',
      body: '本地正文',
      body_version: 9,
      dirty: 'body',
    })
    mockPull(page({ notes: [meta({ version: 2, prop_version: 2, title: '远端较旧' })] }))

    await pullOnce()

    const local = await db.notes.get('r1')
    expect(local).toMatchObject({ title: '本地较新', dirty: 'body' })
    expect(await getBody('r1')).toBe('本地正文')
  })

  it('回收站笔记的删除态会同步到本地', async () => {
    await seedLocal({ ...meta(), body: '', body_version: 1, dirty: 'none' })
    mockPull(page({ notes: [meta({ invalid: 1, prop_version: 2 })] }))

    await pullOnce()

    expect((await db.notes.get('r1'))!.invalid).toBe(1)
  })

  it('outbox 里有未推送的正文任务时不拉远端正文', async () => {
    await seedLocal({ ...meta(), body: '本地写的', body_version: 1, dirty: 'body' })
    await db.outbox.add({
      note_id: 'r1',
      kind: 'body',
      payload: { content: '本地写的', base_version: 1 },
      retry: 0,
      next_at: 0,
      seq: 1,
      failed: 0,
    })
    mockPull(page({ notes: [meta({ version: 9 })] }))

    await pullOnce()

    expect(await getBody('r1')).toBe('本地写的')
  })

  it('远端墓碑（invalid=2）会触发本地物理删除该笔记', async () => {
    await seedLocal({ ...meta(), body: '本地副本', body_version: 1, dirty: 'none' })
    await db.outbox.add({
      note_id: 'r1',
      kind: 'body',
      payload: { content: '本地写的', base_version: 1 },
      retry: 0,
      next_at: 0,
      seq: 1,
      failed: 0,
    })
    mockPull(page({ notes: [meta({ invalid: 2 as 0 | 1 | 2, prop_version: 5 })] }))
    await db.history.add({ note_id: 'r1', time: 1, body: '旧正文' })

    await pullOnce()

    // 墓碑让本地副本被物理删除
    expect(await db.notes.get('r1')).toBeUndefined()
    // 名下未推送任务一并清掉，避免推到已不存在的笔记
    expect(await db.outbox.where('note_id').equals('r1').count()).toBe(0)
    // 本地正文历史也连带清掉
    expect(await db.history.where('note_id').equals('r1').count()).toBe(0)
    const copies = await db.notes.toArray()
    expect(copies).toHaveLength(1)
    expect((await db.bodies.get(copies[0].id))?.body).toContain('本地副本')
    expect(await db.outbox.where('note_id').equals(copies[0].id).count()).toBe(1)
  })

  it('远端墓碑不会无谓删掉本地不存在的笔记', async () => {
    mockPull(page({ notes: [meta({ invalid: 2 as 0 | 1 | 2, prop_version: 5 })] }))

    await pullOnce()

    expect(await db.notes.get('r1')).toBeUndefined()
    // 本轮没有任何写入，不触发 emitRemoteApplied 之外的影响——游标仍推进
    expect(await getMeta<number>(SYNC_CURSOR_KEY)).toBe(5000)
  })

  it('失败态正文仍保留本地输入，不能在重试前被远端正文覆盖', async () => {
    await seedLocal({ ...meta(), body: '本地写的', body_version: 1, dirty: 'body' })
    await db.outbox.add({
      note_id: 'r1',
      kind: 'body',
      payload: { content: '本地写的', base_version: 1 },
      retry: 0,
      next_at: 0,
      seq: 1,
      failed: 1,
    })
    mockPull(page({ notes: [meta({ version: 9 })] }))

    await pullOnce()

    expect(await getBody('r1')).toBe('本地写的')
    expect(await db.outbox.where('note_id').equals('r1').count()).toBe(1)
  })

  it('同一页里出现重复 id 不会让整轮崩掉', async () => {
    // since 用的是 >=，同毫秒写入本就可能重复返回；用 bulkAdd 会抛 ConstraintError，
    // 整轮失败、游标永不推进，同步就此卡死
    mockPull(page({ notes: [meta(), meta()] }))

    await expect(pullOnce()).resolves.toBeDefined()
    expect(await db.notes.count()).toBe(1)
  })

  it('版本相同时不覆盖本地正文——差异只可能来自本轮内的本地编辑', async () => {
    await seedLocal({ ...meta(), body: '刚敲的字', body_version: 1, dirty: 'none' })
    mockPull(page({ notes: [meta({ prop_version: 2 })] }))
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/sync/bodies') {
        return Promise.resolve({ bodies: [{ note_id: 'r1', content: '远端正文', version: 1 }] })
      }
      return Promise.resolve(page({ notes: [meta({ version: 1, prop_version: 2 })] }))
    })

    await pullOnce()

    expect(await getBody('r1')).toBe('刚敲的字')
  })
})

describe('pullOnce 落库前重新检查本地状态', () => {
  it('空缓存先显示元数据，快批次立即可读，慢批次期间保存的本地正文不会被覆盖', async () => {
    const notes = Array.from({ length: 120 }, (_, index) => meta({ id: `n${index}` }))
    let release!: () => void
    const slow = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    const listener = vi.fn()
    const off = onRemoteApplied(listener)
    apiFetch.mockImplementation(async (path: string, options: RequestInit) => {
      if (path !== '/api/sync/bodies') return page({ notes })
      const { ids } = JSON.parse(options.body as string) as { ids: string[] }
      requests++
      if (ids.includes('n119')) await slow
      return { bodies: ids.map(id => ({ note_id: id, content: `远端 ${id}`, version: 1 })) }
    })
    const sync = pullOnce()
    try {
      await vi.waitFor(() => expect(requests).toBe(3))
      await vi.waitFor(async () => expect(await getBody('n0')).toBe('远端 n0'))
      expect((await db.notes.get('n119'))?.body_version).toBe(0)
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(await getMeta(SYNC_CURSOR_KEY)).toBeUndefined()
      await updateBody('n119', '下载期间新写的正文')
    } finally {
      release()
      await sync
      off()
    }
    expect(await getBody('n119')).toBe('下载期间新写的正文')
    expect(await getMeta(SYNC_CURSOR_KEY)).toBe(5000)
  })

  it('某批失败后等待其他在途批次结束才允许重试，不推进游标', async () => {
    let release!: () => void
    const slow = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    let settled = false
    apiFetch.mockImplementation(async (path: string, options: RequestInit) => {
      if (path !== '/api/sync/bodies') return page({ notes: Array.from({ length: 51 }, (_, i) => meta({ id: `n${i}` })) })
      requests++
      const { ids } = JSON.parse(options.body as string) as { ids: string[] }
      if (ids.includes('n50')) throw new Error('一批失败')
      await slow
      return { bodies: ids.map(id => ({ note_id: id, content: '已下载正文', version: 1 })) }
    })
    const sync = pullOnce().catch(error => { settled = true; return error })
    try {
      await vi.waitFor(() => expect(requests).toBe(2))
      expect(settled).toBe(false)
    } finally { release() }
    expect(await sync).toBeInstanceOf(Error)
    expect(await getBody('n0')).toBe('已下载正文')
    expect(await getMeta(SYNC_CURSOR_KEY)).toBeUndefined()
  })

  it('拉正文期间用户又保存了一次，远端正文不覆盖新编辑', async () => {
    await seedLocal({ ...meta(), body: '旧正文', body_version: 1, dirty: 'none' })
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/sync/bodies') {
        // 正文批次在途时用户保存了新内容：outbox 里多了一条 body 任务
        await updateBody('r1', '下载期间敲的字')
        return { bodies: [{ note_id: 'r1', content: '远端正文', version: 2 }] }
      }
      return page({ notes: [meta({ version: 2 })] })
    })

    await pullOnce()

    const local = (await db.notes.get('r1'))!
    // 本地看到的必须和将要上传的是同一份，否则用户以为已保存的字会被推上去的旧内容替掉
    expect(await getBody('r1')).toBe('下载期间敲的字')
    expect(local.body_version).toBe(1)
  })

  it('远端正文落库时同步刷新标题与摘要', async () => {
    await seedLocal({
      ...meta({ title: '旧标题', summary: '旧摘要' }),
      body: '旧正文',
      body_version: 1,
      dirty: 'none',
    })
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/sync/bodies') {
        return Promise.resolve({ bodies: [{ note_id: 'r1', content: '# 新标题\n新的第二行', version: 2 }] })
      }
      return Promise.resolve(page({ notes: [meta({ version: 2, title: '新标题', summary: '新的第二行' })] }))
    })

    await pullOnce()

    // 列表展示的是派生字段；只换正文不换标题，列表会一直显示旧标题旧摘要
    expect(await db.notes.get('r1')).toMatchObject({
      title: '新标题',
      summary: '新的第二行',
    })
    expect(await getBody('r1')).toBe('# 新标题\n新的第二行')
  })

  it('只有分组变化时也通知界面刷新', async () => {
    const listener = vi.fn()
    const off = onRemoteApplied(listener)
    mockPull(
      page({
        groups: [{ group_id: 'g1', name: '工作', ord: 0, color: null, invalid: 0, update_time: 1 }],
      })
    )

    await pullOnce()

    expect(listener).toHaveBeenCalled()
    off()
  })

  it('什么都没拉到时不通知界面', async () => {
    const listener = vi.fn()
    const off = onRemoteApplied(listener)
    mockPull(page())

    await pullOnce()

    expect(listener).not.toHaveBeenCalled()
    off()
  })
})
