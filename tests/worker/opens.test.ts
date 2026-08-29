import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { OpensSyncResponse } from '../../shared/types'
import { api, json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

describe('POST /api/notes/opens', () => {
  it('按设备覆盖累计值，重发同一 payload 不会翻倍', async () => {
    const body = { device_id: 'device-a', since: 0, items: [{ note_id: 'n1', count: 3, last_open_time: 100 }] }
    await json('/api/notes/opens', 'POST', body)
    await json('/api/notes/opens', 'POST', body)
    const row = await env.DB.prepare('SELECT count FROM note_open WHERE note_id = ? AND device_id = ?').bind('n1', 'device-a').first<{ count: number }>()
    expect(row!.count).toBe(3)
  })

  it('聚合结果排除请求方自己的设备', async () => {
    await json('/api/notes/opens', 'POST', { device_id: 'device-a', since: 0, items: [{ note_id: 'n1', count: 2, last_open_time: 10 }] })
    const res = await json('/api/notes/opens', 'POST', { device_id: 'device-b', since: 0, items: [{ note_id: 'n1', count: 5, last_open_time: 20 }] })
    const data = await res.json<OpensSyncResponse>()
    expect(data.opens).toEqual([{ note_id: 'n1', others_count: 2, others_last_open_time: 10 }])
  })

  it('items 超过 500 条返回 400', async () => {
    const res = await json('/api/notes/opens', 'POST', {
      device_id: 'device-a', since: 0,
      items: Array.from({ length: 501 }, (_, i) => ({ note_id: `n${i}`, count: 0, last_open_time: 0 })),
    })
    expect(res.status).toBe(400)
  })

  it('purge 笔记时删除对应打开统计', async () => {
    const note = noteReq()
    await json('/api/notes', 'POST', note)
    await json('/api/notes/opens', 'POST', { device_id: 'device-a', since: 0, items: [{ note_id: note.id, count: 1, last_open_time: 1 }] })
    await api(`/api/notes/${note.id}/purge`, { method: 'POST' })
    expect(await env.DB.prepare('SELECT note_id FROM note_open WHERE note_id = ?').bind(note.id).first()).toBeNull()
  })
})
