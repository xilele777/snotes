import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { setMeta } from '../db/repo'
import { flushOpensSync, scheduleOpensSync, syncOpens } from './opens'
import { clearToken, setToken } from '../api/token'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/client')>()), apiFetch }))

beforeEach(async () => {
  await db.delete()
  await db.open()
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ opens: [], server_time: 123 })
})

afterEach(() => {
  clearToken()
  vi.useRealTimers()
})

describe('syncOpens', () => {
  it('成功后写回其它设备统计、推进游标并只清已发送 dirty', async () => {
    await db.notes.add({ id: 'n1', group_id: null, title: '', summary: '', thumbnail: null, version: 1, prop_version: 1, star: 0, top: 0, skin_color: null, invalid: 0, create_time: 1, update_time: 1, body: '', body_version: 1, dirty: 'none', open_count: 2, last_open_time: 10 })
    await setMeta('device_id', 'device-a')
    await setMeta('opens_dirty', ['n1'])
    apiFetch.mockResolvedValue({ opens: [{ note_id: 'n1', others_count: 7, others_last_open_time: 20 }], server_time: 123 })

    await syncOpens()

    expect(apiFetch).toHaveBeenCalledWith('/api/notes/opens', expect.objectContaining({ method: 'POST' }))
    expect(await db.notes.get('n1')).toMatchObject({ open_others: 7, open_others_time: 20 })
    expect(await db.meta.get('opens_cursor')).toMatchObject({ value: 123 })
    expect(await db.meta.get('opens_dirty')).toMatchObject({ value: [] })
  })

  it('请求失败时保留 dirty 与游标', async () => {
    await db.notes.add({ id: 'n1', group_id: null, title: '', summary: '', thumbnail: null, version: 1, prop_version: 1, star: 0, top: 0, skin_color: null, invalid: 0, create_time: 1, update_time: 1, body: '', body_version: 1, dirty: 'none', open_count: 2, last_open_time: 10 })
    await setMeta('device_id', 'device-a')
    await setMeta('opens_dirty', ['n1'])
    await setMeta('opens_cursor', 9)
    apiFetch.mockRejectedValue(new Error('offline'))

    await expect(syncOpens()).rejects.toThrow('offline')
    expect(await db.meta.get('opens_dirty')).toMatchObject({ value: ['n1'] })
    expect(await db.meta.get('opens_cursor')).toMatchObject({ value: 9 })
  })

  it('节流窗口内多次调度只发送一个请求', async () => {
    setToken('token')
    await setMeta('device_id', 'device-a')
    scheduleOpensSync()
    scheduleOpensSync()
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(apiFetch).toHaveBeenCalledTimes(1)
    scheduleOpensSync()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    // 清掉为后续轮次排队的真实 timer，避免泄漏到其它测试。
    await flushOpensSync()
  })
})

describe('syncOpens 补齐未知的聚合值', () => {
  const note = (over: Record<string, unknown> = {}) => ({
    id: 'n1', group_id: null, title: '', summary: '', thumbnail: null, version: 1, prop_version: 1,
    star: 0, top: 0, skin_color: null, invalid: 0, create_time: 1, update_time: 1, body: '',
    body_version: 1, dirty: 'none', open_count: 2, last_open_time: 10, ...over,
  })

  const sentBody = () => JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)

  it('open_others 未知的笔记会被点名，并按服务端的回答写回', async () => {
    await db.notes.add(note() as never)
    await setMeta('device_id', 'device-a')
    await setMeta('opens_dirty', ['n1'])
    apiFetch.mockResolvedValue({ opens: [{ note_id: 'n1', others_count: 6, others_last_open_time: 60 }], server_time: 9 })

    await syncOpens()

    expect(sentBody().want).toEqual(['n1'])
    expect(await db.notes.get('n1')).toMatchObject({ open_others: 6, open_others_time: 60 })
  })

  it('已经知道聚合值的笔记不再点名', async () => {
    await db.notes.add(note({ open_others: 0, open_others_time: 0 }) as never)
    await setMeta('device_id', 'device-a')
    await setMeta('opens_dirty', ['n1'])
    apiFetch.mockResolvedValue({ opens: [], server_time: 9 })

    await syncOpens()

    expect(sentBody().want).toEqual([])
  })

  it('服务端没回答的笔记保持未知，下一轮继续点名', async () => {
    await db.notes.add(note() as never)
    await setMeta('device_id', 'device-a')
    await setMeta('opens_dirty', ['n1'])
    // 旧服务端不认识 want：什么都不回
    apiFetch.mockResolvedValue({ opens: [], server_time: 9 })

    await syncOpens()

    expect(await db.notes.get('n1')).not.toHaveProperty('open_others', 0)
    expect((await db.notes.get('n1'))!.open_others).toBeUndefined()
  })

  it('墓碑笔记不点名', async () => {
    await db.notes.add(note({ id: 'n2', invalid: 2 }) as never)
    await setMeta('device_id', 'device-a')
    apiFetch.mockResolvedValue({ opens: [], server_time: 9 })

    await syncOpens()

    expect(sentBody().want).toEqual([])
  })
})

describe('opens 点名队列（不再每轮全表扫描）', () => {
  const note = (id: string, over: Record<string, unknown> = {}) => ({
    id, group_id: null, title: '', summary: '', thumbnail: null, version: 1, prop_version: 1,
    star: 0, top: 0, skin_color: null, invalid: 0, create_time: 1, update_time: 1, body: '',
    body_version: 1, dirty: 'none', open_count: 0, last_open_time: 0, ...over,
  })

  it('新建笔记直接进队列，无需回填扫描', async () => {
    const { createNote } = await import('../db/repo')
    const created = await createNote('新笔记')
    expect(((await db.meta.get('opens_unknown'))?.value as string[])).toContain(created.id)
  })

  it('队列未建立时一次性回填旧笔记：未知的问、已知的不问、墓碑不问，回答后出队', async () => {
    await db.notes.bulkAdd([note('a'), note('b', { open_others: 1, open_others_time: 1 }), note('t', { invalid: 2 })] as never[])
    await setMeta('device_id', 'device-a')
    apiFetch.mockResolvedValue({ opens: [{ note_id: 'a', others_count: 0, others_last_open_time: 0 }], server_time: 9 })

    await syncOpens()

    const first = JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(first.want).toEqual(['a'])
    // 服务端已回答 a，队列清空；这之后不再有全表扫描
    expect(((await db.meta.get('opens_unknown'))?.value as string[])).toEqual([])
  })

  it('回答过的笔记从队列出队；未被回答的（旧服务端）保留下一轮再问', async () => {
    await db.notes.bulkAdd([note('a'), note('b')] as never[])
    await setMeta('device_id', 'device-a')
    await setMeta('opens_unknown', ['a', 'b'])
    apiFetch.mockResolvedValue({ opens: [{ note_id: 'a', others_count: 0, others_last_open_time: 0 }], server_time: 9 })

    await syncOpens()

    expect(((await db.meta.get('opens_unknown'))?.value as string[])).toEqual(['b'])
  })

  it('问询前发现已被本地删除的笔记直接丢弃，不再点名', async () => {
    // 队列里的 gone 没有对应笔记行（已被物理删除）
    await db.notes.add(note('kept') as never)
    await setMeta('device_id', 'device-a')
    await setMeta('opens_unknown', ['gone', 'kept'])
    apiFetch.mockResolvedValue({ opens: [{ note_id: 'kept', others_count: 0, others_last_open_time: 0 }], server_time: 9 })

    await syncOpens()

    const first = JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(first.want).toEqual(['kept'])
    expect(((await db.meta.get('opens_unknown'))?.value as string[])).toEqual([])
  })
})
