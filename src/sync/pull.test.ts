import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteMeta, PullResponse } from '../../shared/types'
import { ApiError } from '../api/client'
import { getMeta } from '../db/repo'
import { db } from '../db/schema'
import { SYNC_CURSOR_KEY, pullOnce } from './pull'

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
  const bodies = { bodies: [{ note_id: 'r1', content: '远端正文', version: 1 }] }

  apiFetch.mockImplementation((path: string) => {
    if (path === '/api/sync/bodies') return Promise.resolve(bodies)
    return Promise.resolve(responses.shift() ?? page())
  })
}

describe('pullOnce', () => {
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
    expect(local).toMatchObject({ title: '远端标题', body: '远端正文', dirty: 'none' })
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
    await db.notes.add({
      ...meta(),
      body: '本地正文',
      body_version: 1,
      dirty: 'none',
    })
    mockPull(page({ notes: [meta({ prop_version: 5, star: 1 })] }))

    await pullOnce()

    const local = await db.notes.get('r1')
    expect(local).toMatchObject({ star: 1, prop_version: 5, body: '本地正文' })
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
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/sync/bodies') return Promise.resolve({ bodies: [] })
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

  it('本地有未推送修改时，远端旧版本不会覆盖它', async () => {
    await db.notes.add({
      ...meta({ version: 9, prop_version: 9 }),
      title: '本地较新',
      body: '本地正文',
      body_version: 9,
      dirty: 'body',
    })
    mockPull(page({ notes: [meta({ version: 2, prop_version: 2, title: '远端较旧' })] }))

    await pullOnce()

    const local = await db.notes.get('r1')
    expect(local).toMatchObject({ title: '本地较新', body: '本地正文', dirty: 'body' })
  })

  it('回收站笔记的删除态会同步到本地', async () => {
    await db.notes.add({ ...meta(), body: '', body_version: 1, dirty: 'none' })
    mockPull(page({ notes: [meta({ invalid: 1, prop_version: 2 })] }))

    await pullOnce()

    expect((await db.notes.get('r1'))!.invalid).toBe(1)
  })

  it('outbox 里有未推送的正文任务时不拉远端正文', async () => {
    await db.notes.add({ ...meta(), body: '本地写的', body_version: 1, dirty: 'body' })
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

    expect((await db.notes.get('r1'))!.body).toBe('本地写的')
  })

  it('远端墓碑（invalid=2）会触发本地物理删除该笔记', async () => {
    await db.notes.add({ ...meta(), body: '本地副本', body_version: 1, dirty: 'none' })
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

    await pullOnce()

    // 墓碑让本地副本被物理删除
    expect(await db.notes.get('r1')).toBeUndefined()
    // 名下未推送任务一并清掉，避免推到已不存在的笔记
    expect(await db.outbox.where('note_id').equals('r1').count()).toBe(0)
  })

  it('远端墓碑不会无谓删掉本地不存在的笔记', async () => {
    mockPull(page({ notes: [meta({ invalid: 2 as 0 | 1 | 2, prop_version: 5 })] }))

    await pullOnce()

    expect(await db.notes.get('r1')).toBeUndefined()
    // 本轮没有任何写入，不触发 emitRemoteApplied 之外的影响——游标仍推进
    expect(await getMeta<number>(SYNC_CURSOR_KEY)).toBe(5000)
  })

  it('失败态的任务不再挡住 pull——否则那条笔记永远收不到远端更新', async () => {
    await db.notes.add({ ...meta(), body: '本地写的', body_version: 1, dirty: 'body' })
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

    expect((await db.notes.get('r1'))!.body).toBe('远端正文')
  })

  it('同一页里出现重复 id 不会让整轮崩掉', async () => {
    // since 用的是 >=，同毫秒写入本就可能重复返回；用 bulkAdd 会抛 ConstraintError，
    // 整轮失败、游标永不推进，同步就此卡死
    mockPull(page({ notes: [meta(), meta()] }))

    await expect(pullOnce()).resolves.toBeDefined()
    expect(await db.notes.count()).toBe(1)
  })

  it('版本相同时不覆盖本地正文——差异只可能来自本轮内的本地编辑', async () => {
    await db.notes.add({ ...meta(), body: '刚敲的字', body_version: 1, dirty: 'none' })
    mockPull(page({ notes: [meta({ prop_version: 2 })] }))
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/sync/bodies') {
        return Promise.resolve({ bodies: [{ note_id: 'r1', content: '远端正文', version: 1 }] })
      }
      return Promise.resolve(page({ notes: [meta({ version: 1, prop_version: 2 })] }))
    })

    await pullOnce()

    expect((await db.notes.get('r1'))!.body).toBe('刚敲的字')
  })
})
