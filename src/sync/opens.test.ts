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
