import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../worker/app'

describe('schema', () => {
  it('创建了全部四张表', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name"
    ).all<{ name: string }>()

    expect(results.map((r) => r.name)).toEqual(['image', 'note', 'note_body', 'note_group'])
  })

  it('note 表带默认值插入后各字段符合预期', async () => {
    await env.DB.prepare(
      'INSERT INTO note (id, title, create_time, update_time) VALUES (?, ?, ?, ?)'
    )
      .bind('n1', 'hello', 1000, 2000)
      .run()

    const row = await env.DB.prepare('SELECT * FROM note WHERE id = ?').bind('n1').first()

    expect(row).toMatchObject({
      id: 'n1',
      title: 'hello',
      version: 1,
      prop_version: 1,
      star: 0,
      top: 0,
      invalid: 0,
      group_id: null,
    })
  })

  it('删除 note 会级联删除 note_body', async () => {
    await env.DB.prepare('INSERT INTO note (id, create_time, update_time) VALUES (?, ?, ?)')
      .bind('n2', 1, 1)
      .run()
    await env.DB.prepare('INSERT INTO note_body (note_id, content) VALUES (?, ?)')
      .bind('n2', '正文')
      .run()

    await env.DB.prepare('DELETE FROM note WHERE id = ?').bind('n2').run()

    const body = await env.DB.prepare('SELECT * FROM note_body WHERE note_id = ?').bind('n2').first()
    expect(body).toBeNull()
  })

  it('health 端点可经 app.request 调用', async () => {
    const app = createApp()
    const res = await app.request('/api/health', {}, env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
