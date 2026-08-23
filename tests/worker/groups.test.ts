import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

describe('POST /api/groups', () => {
  it('创建分组并返回服务端时间', async () => {
    const res = await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })

    expect(res.status).toBe(200)
    expect((await res.json<{ update_time: number }>()).update_time).toBeGreaterThan(0)

    const row = await env.DB.prepare('SELECT * FROM note_group WHERE group_id = ?').bind('g1').first()
    expect(row).toMatchObject({ name: '工作', ord: 0, invalid: 0, color: null })
  })

  it('可带排序与颜色', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作', ord: 5, color: '#ff0000' })

    const row = await env.DB.prepare('SELECT * FROM note_group WHERE group_id = ?').bind('g1').first()
    expect(row).toMatchObject({ ord: 5, color: '#ff0000' })
  })

  it('重放同一 group_id 幂等', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })
    const res = await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })

    expect(res.status).toBe(200)
    const { results } = await env.DB.prepare('SELECT group_id FROM note_group').all()
    expect(results).toHaveLength(1)
  })

  it('缺少 name 返回 400', async () => {
    const res = await json('/api/groups', 'POST', { group_id: 'g1' })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/groups/:id', () => {
  it('改名并推进 update_time', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })

    const res = await json('/api/groups/g1', 'PATCH', { name: '生活' })
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT name FROM note_group WHERE group_id = ?')
      .bind('g1')
      .first()
    expect(row!.name).toBe('生活')
  })

  it('只改排序不影响名称', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })
    await json('/api/groups/g1', 'PATCH', { ord: 9 })

    const row = await env.DB.prepare('SELECT name, ord FROM note_group WHERE group_id = ?')
      .bind('g1')
      .first()
    expect(row).toMatchObject({ name: '工作', ord: 9 })
  })

  it('不存在返回 404', async () => {
    const res = await json('/api/groups/nope', 'PATCH', { name: 'x' })
    expect(res.status).toBe(404)
  })

  it('空 patch 返回 400', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })
    const res = await json('/api/groups/g1', 'PATCH', {})
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/groups/:id', () => {
  it('软删除分组，行仍在但 invalid=1', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })

    const res = await api('/api/groups/g1', { method: 'DELETE' })
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT invalid FROM note_group WHERE group_id = ?')
      .bind('g1')
      .first()
    expect(row!.invalid).toBe(1)
  })

  it('组内笔记回到未分组，且不被删除', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })
    const req = noteReq({ group_id: 'g1' })
    await json('/api/notes', 'POST', req)

    await api('/api/groups/g1', { method: 'DELETE' })

    const note = await env.DB.prepare('SELECT id, group_id FROM note WHERE id = ?')
      .bind(req.id)
      .first()
    expect(note).not.toBeNull()
    expect(note!.group_id).toBeNull()
  })

  it('解绑会推进笔记的 prop_version，使其能同步到其他端', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })
    const req = noteReq({ group_id: 'g1' })
    await json('/api/notes', 'POST', req)

    await api('/api/groups/g1', { method: 'DELETE' })

    const note = await env.DB.prepare('SELECT prop_version FROM note WHERE id = ?')
      .bind(req.id)
      .first<{ prop_version: number }>()
    expect(note!.prop_version).toBe(2)
  })
})
