import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

describe('POST /api/notes', () => {
  it('创建后返回初始版本号与服务端时间', async () => {
    const req = noteReq()
    const res = await json('/api/notes', 'POST', req)

    expect(res.status).toBe(200)
    const body = await res.json<{ update_time: number }>()
    expect(body).toMatchObject({ id: req.id, version: 1, prop_version: 1 })
    expect(body.update_time).toBeGreaterThan(0)
  })

  it('正文与派生字段都落库', async () => {
    const req = noteReq({ content: '正文内容', title: '正文内容', summary: '正文内容' })
    await json('/api/notes', 'POST', req)

    const note = await env.DB.prepare('SELECT * FROM note WHERE id = ?').bind(req.id).first()
    const body = await env.DB.prepare('SELECT * FROM note_body WHERE note_id = ?').bind(req.id).first()

    expect(note).toMatchObject({ title: '正文内容', summary: '正文内容', version: 1 })
    expect(body).toMatchObject({ content: '正文内容', version: 1 })
  })

  it('create_time 用客户端值，update_time 用服务端时钟', async () => {
    const req = noteReq({ create_time: 111 })
    await json('/api/notes', 'POST', req)

    const note = await env.DB.prepare('SELECT * FROM note WHERE id = ?').bind(req.id).first<{
      create_time: number
      update_time: number
    }>()

    expect(note!.create_time).toBe(111)
    expect(note!.update_time).toBeGreaterThan(1_700_000_000_000)
  })

  it('重放同一 id 不产生第二条，保证离线重试安全', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)
    const second = await json('/api/notes', 'POST', req)

    expect(second.status).toBe(200)
    const { results } = await env.DB.prepare('SELECT id FROM note WHERE id = ?').bind(req.id).all()
    expect(results).toHaveLength(1)
  })

  it('缺少必填字段返回 400', async () => {
    const res = await json('/api/notes', 'POST', { id: 'x' })
    expect(res.status).toBe(400)
  })

  it('未鉴权返回 401', async () => {
    const res = await json('/api/notes', 'POST', noteReq(), null)
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/notes/:id', () => {
  it('改正文递增 version，不动 prop_version', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)

    const res = await json(`/api/notes/${req.id}`, 'PATCH', {
      content: '新正文',
      title: '新正文',
      summary: '新正文',
      base_version: 1,
    })

    const body = await res.json()
    expect(body).toMatchObject({ version: 2, prop_version: 1, conflicted: false })

    const stored = await env.DB.prepare('SELECT content, version FROM note_body WHERE note_id = ?')
      .bind(req.id)
      .first()
    expect(stored).toMatchObject({ content: '新正文', version: 2 })
  })

  it('改属性递增 prop_version，不动 version 也不碰正文', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)

    const res = await json(`/api/notes/${req.id}`, 'PATCH', { star: 1, base_prop_version: 1 })

    expect(await res.json()).toMatchObject({ version: 1, prop_version: 2, conflicted: false })

    const stored = await env.DB.prepare('SELECT content, version FROM note_body WHERE note_id = ?')
      .bind(req.id)
      .first()
    expect(stored).toMatchObject({ content: req.content, version: 1 })
  })

  it('同时改正文与属性则两个版本号都递增', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)

    const res = await json(`/api/notes/${req.id}`, 'PATCH', {
      content: 'c',
      title: 'c',
      summary: 'c',
      top: 1,
      base_version: 1,
      base_prop_version: 1,
    })

    expect(await res.json()).toMatchObject({ version: 2, prop_version: 2 })
  })

  it('base_version 落后于服务端时按 LWW 接受但标记 conflicted', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)
    await json(`/api/notes/${req.id}`, 'PATCH', { content: 'a', title: 'a', summary: 'a', base_version: 1 })

    const res = await json(`/api/notes/${req.id}`, 'PATCH', {
      content: 'b',
      title: 'b',
      summary: 'b',
      base_version: 1,
    })

    const body = await res.json<{ conflicted: boolean; version: number }>()
    expect(body.conflicted).toBe(true)
    expect(body.version).toBe(3)

    const stored = await env.DB.prepare('SELECT content FROM note_body WHERE note_id = ?')
      .bind(req.id)
      .first<{ content: string }>()
    expect(stored!.content).toBe('b')
  })

  it('属性冲突同样标记 conflicted', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)
    await json(`/api/notes/${req.id}`, 'PATCH', { star: 1, base_prop_version: 1 })

    const res = await json(`/api/notes/${req.id}`, 'PATCH', { top: 1, base_prop_version: 1 })

    expect((await res.json<{ conflicted: boolean }>()).conflicted).toBe(true)
  })

  it('group_id 可置为 null 表示移出分组', async () => {
    const req = noteReq({ group_id: 'g1' })
    await json('/api/notes', 'POST', req)

    await json(`/api/notes/${req.id}`, 'PATCH', { group_id: null, base_prop_version: 1 })

    const note = await env.DB.prepare('SELECT group_id FROM note WHERE id = ?').bind(req.id).first()
    expect(note!.group_id).toBeNull()
  })

  it('不存在的 id 返回 404', async () => {
    const res = await json('/api/notes/nope', 'PATCH', { star: 1 })
    expect(res.status).toBe(404)
  })

  it('提交 content 但缺少 title 或 summary 返回 400', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)

    const res = await json(`/api/notes/${req.id}`, 'PATCH', { content: '只有正文' })
    expect(res.status).toBe(400)
  })

  it('提交 content 但缺少 base_version 返回 400', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)

    const res = await json(`/api/notes/${req.id}`, 'PATCH', {
      content: 'x',
      title: 'x',
      summary: 'x',
    })
    expect(res.status).toBe(400)
  })

  it('只改属性但缺少 base_prop_version 返回 400', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)

    const res = await json(`/api/notes/${req.id}`, 'PATCH', { star: 1 })
    expect(res.status).toBe(400)
  })

  it('空 body 返回 400', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)

    const res = await json(`/api/notes/${req.id}`, 'PATCH', {})
    expect(res.status).toBe(400)
  })
})
