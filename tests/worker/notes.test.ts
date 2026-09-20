import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PatchNoteResponse } from '../../shared/types'
import { api, json, noteReq, resetDb } from './helpers'

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

describe('POST /api/notes 复活墓碑', () => {
  it('彻底删除后用同一 id 再创建（导入备份）会复活为正常笔记，版本号推进', async () => {
    const req = noteReq({ content: '旧正文', title: '旧', summary: '旧' })
    await json('/api/notes', 'POST', req)
    await api(`/api/notes/${req.id}/purge`, { method: 'POST' })

    const res = await json('/api/notes', 'POST', { ...req, content: '导入回来的正文', title: '新', summary: '新', star: 1 })
    expect(res.status).toBe(200)
    const ack = await res.json<{ version: number; prop_version: number }>()
    expect(ack).toMatchObject({ id: req.id, version: 2, prop_version: 3 })

    const note = await env.DB.prepare('SELECT invalid, version, prop_version, title, star FROM note WHERE id = ?').bind(req.id).first()
    expect(note).toMatchObject({ invalid: 0, version: 2, prop_version: 3, title: '新', star: 1 })
    const body = await env.DB.prepare('SELECT content, version FROM note_body WHERE note_id = ?').bind(req.id).first()
    expect(body).toMatchObject({ content: '导入回来的正文', version: 2 })

    // pull 会把它当作一条正常的远端变更下发，而不是墓碑
    const pull = await json('/api/sync/pull', 'POST', { since: 0 })
    const { notes } = await pull.json<{ notes: { id: string; invalid: number }[] }>()
    expect(notes.find((n) => n.id === req.id)).toMatchObject({ invalid: 0 })
  })

  it('普通已存在的 id 仍然幂等：不覆盖也不推进版本', async () => {
    const req = noteReq({ content: '原正文', title: '原', summary: '原' })
    await json('/api/notes', 'POST', req)
    const res = await json('/api/notes', 'POST', { ...req, content: '重放', title: '重放', summary: '重放' })
    expect(await res.json()).toMatchObject({ version: 1, prop_version: 1 })
    const body = await env.DB.prepare('SELECT content FROM note_body WHERE note_id = ?').bind(req.id).first()
    expect(body).toMatchObject({ content: '原正文' })
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

  it('重放已经成功的同一正文 PATCH 时幂等，不递增版本也不标记冲突', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)

    const payload = {
      content: '新正文',
      title: '新正文',
      summary: '新正文',
      base_version: 1,
    }
    const first = await json(`/api/notes/${req.id}`, 'PATCH', payload)
    const firstBody = await first.json<{ version: number; update_time: number }>()

    const replay = await json(`/api/notes/${req.id}`, 'PATCH', payload)
    expect(await replay.json()).toMatchObject({
      version: firstBody.version,
      update_time: firstBody.update_time,
      conflicted: false,
    })
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

describe('PATCH /api/notes/:id 冲突时保住被覆盖的正文', () => {
  async function seed() {
    const req = noteReq()
    await json('/api/notes', 'POST', req)
    return req
  }

  it('正文冲突时回传被覆盖的旧正文，客户端据此另存副本', async () => {
    const req = await seed()
    await json(`/api/notes/${req.id}`, 'PATCH', { content: '甲的内容', title: '甲', summary: '', base_version: 1 })

    const res = await json(`/api/notes/${req.id}`, 'PATCH', { content: '乙的内容', title: '乙', summary: '', base_version: 1 })

    // 后写者胜：乙的内容落库；但甲的内容不能就此消失，必须随响应带回去
    const body = await res.json<PatchNoteResponse>()
    expect(body).toMatchObject({ conflicted: true, version: 3, previous_content: '甲的内容' })
    const stored = await env.DB.prepare('SELECT content FROM note_body WHERE note_id = ?')
      .bind(req.id)
      .first<{ content: string }>()
    expect(stored!.content).toBe('乙的内容')
  })

  it('无冲突时不回传 previous_content', async () => {
    const req = await seed()

    const res = await json(`/api/notes/${req.id}`, 'PATCH', { content: '新', title: '新', summary: '', base_version: 1 })

    const body = await res.json<PatchNoteResponse>()
    expect(body.conflicted).toBe(false)
    expect(body).not.toHaveProperty('previous_content')
  })

  it('只有属性冲突时不回传 previous_content——属性被覆盖不值得多一条笔记', async () => {
    const req = await seed()
    await json(`/api/notes/${req.id}`, 'PATCH', { star: 1, base_prop_version: 1 })

    const res = await json(`/api/notes/${req.id}`, 'PATCH', { top: 1, base_prop_version: 1 })

    const body = await res.json<PatchNoteResponse>()
    expect(body.conflicted).toBe(true)
    expect(body).not.toHaveProperty('previous_content')
  })

  it('同一基线的两次并发提交只能有一次不冲突', async () => {
    const req = await seed()

    // 两个请求都读到 version=1；版本检查与写入若不是原子的，两边都会写成 2 且都不报冲突，
    // 其中一份正文就被静默覆盖了
    const [resA, resB] = await Promise.all([
      json(`/api/notes/${req.id}`, 'PATCH', { content: 'A', title: 'A', summary: '', base_version: 1 }),
      json(`/api/notes/${req.id}`, 'PATCH', { content: 'B', title: 'B', summary: '', base_version: 1 }),
    ])
    const [a, b] = await Promise.all([resA.json<PatchNoteResponse>(), resB.json<PatchNoteResponse>()])

    const conflicted = [a, b].filter((r) => r.conflicted)
    expect(conflicted).toHaveLength(1)
    expect([a.version, b.version].sort()).toEqual([2, 3])
    // 被判冲突的那一次拿回的是先落库那一版的正文
    expect(conflicted[0].previous_content).toBe(a.conflicted ? 'B' : 'A')

    const stored = await env.DB.prepare('SELECT version FROM note WHERE id = ?')
      .bind(req.id)
      .first<{ version: number }>()
    expect(stored!.version).toBe(3)
  })

  it('已彻底删除的墓碑不能再 PATCH', async () => {
    const req = await seed()
    await api(`/api/notes/${req.id}/purge`, { method: 'POST' })

    const res = await json(`/api/notes/${req.id}`, 'PATCH', { content: '复活', title: '复活', summary: '', base_version: 1 })

    // 正文行已回收，接受这次写入只会造出一条没有正文的「已保存」笔记
    expect(res.status).toBe(404)
    const note = await env.DB.prepare('SELECT invalid FROM note WHERE id = ?').bind(req.id).first<{ invalid: number }>()
    expect(note!.invalid).toBe(2)
  })
})
