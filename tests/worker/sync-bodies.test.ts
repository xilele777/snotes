import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { BodiesResponse } from '../../shared/types'
import { json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

async function seedNotes(n: number) {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const req = noteReq({ content: `正文${i}`, title: `t${i}`, summary: `s${i}` })
    await json('/api/notes', 'POST', req)
    ids.push(req.id)
  }
  return ids
}

describe('POST /api/sync/bodies', () => {
  it('按 id 批量返回正文与版本', async () => {
    const [a, b] = await seedNotes(2)

    const res = await json('/api/sync/bodies', 'POST', { ids: [a, b] })
    const body = await res.json<BodiesResponse>()

    expect(body.bodies).toHaveLength(2)
    expect(body.bodies.find((x) => x.note_id === a)).toMatchObject({ content: '正文0', version: 1 })
  })

  it('忽略不存在的 id，不报错', async () => {
    const [a] = await seedNotes(1)

    const res = await json('/api/sync/bodies', 'POST', { ids: [a, 'nope'] })
    const body = await res.json<BodiesResponse>()

    expect(body.bodies.map((b) => b.note_id)).toEqual([a])
  })

  it('空数组返回空结果', async () => {
    const res = await json('/api/sync/bodies', 'POST', { ids: [] })
    expect(await res.json()).toEqual({ bodies: [] })
  })

  it('超过 50 条返回 400', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`)
    const res = await json('/api/sync/bodies', 'POST', { ids })
    expect(res.status).toBe(400)
  })

  it('恰好 50 条可以通过', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`)
    const res = await json('/api/sync/bodies', 'POST', { ids })
    expect(res.status).toBe(200)
  })

  it('ids 不是数组返回 400', async () => {
    const res = await json('/api/sync/bodies', 'POST', { ids: 'a' })
    expect(res.status).toBe(400)
  })

  it('ids 里混入非字符串返回 400，而不是让脏值把整批打成 500', async () => {
    const res = await json('/api/sync/bodies', 'POST', { ids: ['ok', { evil: 1 }] })
    expect(res.status).toBe(400)
  })

  it('回收站笔记的正文照常返回，以便恢复后可见', async () => {
    const [a] = await seedNotes(1)
    await env.DB.prepare('UPDATE note SET invalid = 1 WHERE id = ?').bind(a).run()

    const res = await json('/api/sync/bodies', 'POST', { ids: [a] })
    const body = await res.json<BodiesResponse>()

    expect(body.bodies).toHaveLength(1)
  })
})
