import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

async function seedNote() {
  const req = noteReq()
  await json('/api/notes', 'POST', req)
  return req
}

describe('POST /api/notes/:id/trash', () => {
  it('置 invalid=1 并递增 prop_version', async () => {
    const req = await seedNote()

    const res = await api(`/api/notes/${req.id}/trash`, { method: 'POST' })

    expect(await res.json()).toMatchObject({ prop_version: 2 })
    const note = await env.DB.prepare('SELECT invalid FROM note WHERE id = ?').bind(req.id).first()
    expect(note!.invalid).toBe(1)
  })

  it('不删除正文，恢复后内容仍在', async () => {
    const req = await seedNote()
    await api(`/api/notes/${req.id}/trash`, { method: 'POST' })

    const body = await env.DB.prepare('SELECT content FROM note_body WHERE note_id = ?')
      .bind(req.id)
      .first<{ content: string }>()
    expect(body!.content).toBe(req.content)
  })

  it('不存在的 id 返回 404', async () => {
    const res = await api('/api/notes/nope/trash', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/notes/:id/recover', () => {
  it('置 invalid=0 并再次递增 prop_version', async () => {
    const req = await seedNote()
    await api(`/api/notes/${req.id}/trash`, { method: 'POST' })

    const res = await api(`/api/notes/${req.id}/recover`, { method: 'POST' })

    expect(await res.json()).toMatchObject({ prop_version: 3 })
    const note = await env.DB.prepare('SELECT invalid FROM note WHERE id = ?').bind(req.id).first()
    expect(note!.invalid).toBe(0)
  })
})

describe('POST /api/notes/:id/purge', () => {
  it('物理删除笔记与正文', async () => {
    const req = await seedNote()

    const res = await api(`/api/notes/${req.id}/purge`, { method: 'POST' })
    expect(await res.json()).toEqual({ ok: true })

    const note = await env.DB.prepare('SELECT id FROM note WHERE id = ?').bind(req.id).first()
    const body = await env.DB.prepare('SELECT note_id FROM note_body WHERE note_id = ?')
      .bind(req.id)
      .first()
    expect(note).toBeNull()
    expect(body).toBeNull()
  })

  it('连带删除该笔记的图片记录与 R2 对象', async () => {
    const req = await seedNote()
    await env.R2.put('k1.png', new Uint8Array([1, 2, 3]))
    await env.DB.prepare(
      'INSERT INTO image (file_key, note_id, size, mime, create_time) VALUES (?, ?, ?, ?, ?)'
    )
      .bind('k1.png', req.id, 3, 'image/png', 1)
      .run()

    await api(`/api/notes/${req.id}/purge`, { method: 'POST' })

    expect(await env.R2.get('k1.png')).toBeNull()
    const img = await env.DB.prepare('SELECT file_key FROM image WHERE file_key = ?')
      .bind('k1.png')
      .first()
    expect(img).toBeNull()
  })
})

describe('POST /api/trash/clean', () => {
  it('只物理删除 invalid=1 的笔记并返回其 id', async () => {
    const trashed = await seedNote()
    const kept = await seedNote()
    await api(`/api/notes/${trashed.id}/trash`, { method: 'POST' })

    const res = await json('/api/trash/clean', 'POST', {})
    const body = await res.json<{ purged: string[] }>()

    expect(body.purged).toEqual([trashed.id])

    const goneNote = await env.DB.prepare('SELECT id FROM note WHERE id = ?').bind(trashed.id).first()
    const keptNote = await env.DB.prepare('SELECT id FROM note WHERE id = ?').bind(kept.id).first()
    expect(goneNote).toBeNull()
    expect(keptNote).not.toBeNull()
  })

  it('回收站为空时返回空数组', async () => {
    const res = await json('/api/trash/clean', 'POST', {})
    expect(await res.json()).toEqual({ purged: [] })
  })

  it('清空时回收全部相关 R2 图片', async () => {
    const trashed = await seedNote()
    await env.R2.put('a.png', new Uint8Array([1]))
    await env.DB.prepare(
      'INSERT INTO image (file_key, note_id, size, mime, create_time) VALUES (?, ?, ?, ?, ?)'
    )
      .bind('a.png', trashed.id, 1, 'image/png', 1)
      .run()
    await api(`/api/notes/${trashed.id}/trash`, { method: 'POST' })

    await json('/api/trash/clean', 'POST', {})

    expect(await env.R2.get('a.png')).toBeNull()
  })
})
