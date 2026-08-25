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

    // Bug 2：purge 现在置 invalid=2（墓碑），note 行保留以便跨端同步删除信号；
    // 正文与图片则立即回收。
    const note = await env.DB.prepare('SELECT invalid FROM note WHERE id = ?').bind(req.id).first<{ invalid: number }>()
    const body = await env.DB.prepare('SELECT note_id FROM note_body WHERE note_id = ?')
      .bind(req.id)
      .first()
    expect(note!.invalid).toBe(2)
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

    // Bug 2：被清空的笔记置 invalid=2（墓碑）而非立即 DELETE，
    // 保留行让其它客户端 pull 时能收到删除信号；未被清空的笔记保持 invalid=0。
    const goneNote = await env.DB.prepare('SELECT invalid FROM note WHERE id = ?').bind(trashed.id).first<{ invalid: number }>()
    const keptNote = await env.DB.prepare('SELECT invalid FROM note WHERE id = ?').bind(kept.id).first<{ invalid: number }>()
    expect(goneNote!.invalid).toBe(2)
    expect(keptNote!.invalid).toBe(0)
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



import type { PullResponse } from '../../shared/types'

describe('软删除墓碑跨端同步（Bug 2）', () => {
  it('purge 后 pull 仍返回该笔记，标记 invalid=2', async () => {
    const req = await seedNote()
    await api(`/api/notes/${req.id}/purge`, { method: 'POST' })

    const res = await json('/api/sync/pull', 'POST', { since: 0 })
    const body = await res.json<PullResponse>()
    expect(body.notes.find((n) => n.id === req.id)).toMatchObject({ invalid: 2 })
  })

  it('清空回收站后 pull 仍返回被清空的笔记，标记 invalid=2', async () => {
    const trashed = await seedNote()
    await api(`/api/notes/${trashed.id}/trash`, { method: 'POST' })
    await json('/api/trash/clean', 'POST', {})

    const res = await json('/api/sync/pull', 'POST', { since: 0 })
    const body = await res.json<PullResponse>()
    expect(body.notes.find((n) => n.id === trashed.id)).toMatchObject({ invalid: 2 })
  })

  it('purge 后 prop_version 递增，让 planPull 识别为需要同步', async () => {
    const req = await seedNote()
    const before = await env.DB.prepare('SELECT prop_version FROM note WHERE id = ?')
      .bind(req.id)
      .first<{ prop_version: number }>()
    await api(`/api/notes/${req.id}/purge`, { method: 'POST' })
    const after = await env.DB.prepare('SELECT prop_version FROM note WHERE id = ?')
      .bind(req.id)
      .first<{ prop_version: number }>()
    expect(after!.prop_version).toBe(before!.prop_version + 1)
  })
})



