import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../worker/app'
import type { Database } from '../../worker/storage'
import type { PullResponse } from '../../shared/types'
import { json, noteReq, resetDb, TOKEN } from './helpers'

beforeEach(resetDb)

async function seed(id: string, updateTime: number, over: Record<string, unknown> = {}) {
  await env.DB.prepare(
    `INSERT INTO note (id, title, summary, version, prop_version, invalid, create_time, update_time)
     VALUES (?, ?, '', ?, ?, ?, 1, ?)`
  )
    .bind(id, over.title ?? id, over.version ?? 1, over.prop_version ?? 1, over.invalid ?? 0, updateTime)
    .run()
  // Fixtures intentionally exercise historical/equal timestamps; normal writes
  // are assigned commit-ordered timestamps by the database triggers.
  await env.DB.prepare('UPDATE note SET update_time = ? WHERE id = ?').bind(updateTime, id).run()
  await env.DB.prepare('INSERT INTO note_body (note_id, content, version) VALUES (?, ?, ?)')
    .bind(id, `正文-${id}`, over.version ?? 1)
    .run()
}

async function pull(body: Record<string, unknown>) {
  const res = await json('/api/sync/pull', 'POST', body)
  return res.json<PullResponse>()
}

describe('POST /api/sync/pull', () => {
  it('a create committing after a completed pull cannot fall behind its watermark', async () => {
    const req = noteReq()
    const time = vi.spyOn(Date, 'now').mockReturnValue(100)
    let watermark = 0
    const delayed: Database = {
      prepare: sql => env.DB.prepare(sql),
      async batch(statements) {
        time.mockReturnValue(200)
        const snapshot = await pull({ since: 0 })
        expect(snapshot.notes.some(n => n.id === req.id)).toBe(false)
        watermark = snapshot.server_time
        return env.DB.batch(statements as D1PreparedStatement[])
      },
    }
    try {
      const response = await createApp().request('/api/notes', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(req) }, { ...env, DB: delayed })
      expect(response.status).toBe(200)
      const incremental = await pull({ since: watermark })
      expect(incremental.notes.find(n => n.id === req.id)!.update_time).toBeGreaterThan(watermark)
    } finally { time.mockRestore() }
  })

  it('group commits and clock rollback still advance beyond the previous pull watermark', async () => {
    const first = await pull({ since: 0 })
    await env.DB.prepare("INSERT INTO note_group (group_id, name, ord, invalid, update_time) VALUES ('late-group', 'Late', 0, 0, 1)").run()
    const next = await pull({ since: first.server_time })
    expect(next.groups.find(g => g.group_id === 'late-group')!.update_time).toBeGreaterThan(first.server_time)
    const time = vi.spyOn(Date, 'now').mockReturnValue(1)
    try {
      await json('/api/groups/late-group', 'PATCH', { name: 'Renamed' })
      const renamed = await pull({ since: next.server_time })
      expect(renamed.groups.find(g => g.group_id === 'late-group')).toMatchObject({ name: 'Renamed' })
      expect(renamed.server_time).toBeGreaterThan(next.server_time)
    } finally { time.mockRestore() }
  })
  it('since=0 返回全部笔记', async () => {
    await seed('a', 100)
    await seed('b', 200)

    const body = await pull({ since: 0 })

    expect(body.notes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(body.next_cursor).toBeNull()
    expect(body.server_time).toBeGreaterThan(0)
  })

  it('用 >= 而非 > ，同毫秒写入不会被跳过', async () => {
    await seed('a', 100)
    await seed('b', 100)

    const body = await pull({ since: 100 })

    expect(body.notes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('早于 since 的笔记不返回', async () => {
    await seed('old', 50)
    await seed('new', 150)

    const body = await pull({ since: 100 })

    expect(body.notes.map((n) => n.id)).toEqual(['new'])
  })

  it('回收站笔记照常返回，客户端据此同步删除态', async () => {
    await seed('trashed', 100, { invalid: 1 })

    const body = await pull({ since: 0 })

    expect(body.notes[0]).toMatchObject({ id: 'trashed', invalid: 1 })
  })

  it('墓碑笔记（invalid=2）照常返回，客户端据此删本地副本', async () => {
    await seed('purged', 100, { invalid: 2 })

    const body = await pull({ since: 0 })

    expect(body.notes[0]).toMatchObject({ id: 'purged', invalid: 2 })
  })

  it('分页：达到 limit 时给出 next_cursor', async () => {
    await seed('a', 100)
    await seed('b', 200)
    await seed('c', 300)

    const first = await pull({ since: 0, limit: 2 })

    expect(first.notes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(first.next_cursor).not.toBeNull()

    const second = await pull({ since: 0, limit: 2, cursor: first.next_cursor })

    expect(second.notes.map((n) => n.id)).toEqual(['c'])
    expect(second.next_cursor).toBeNull()
  })

  it('同毫秒的多条记录在分页中既不重复也不遗漏', async () => {
    await seed('a', 100)
    await seed('b', 100)
    await seed('c', 100)

    const seen: string[] = []
    let cursor: string | null = null

    for (let i = 0; i < 5; i++) {
      const page: PullResponse = await pull({ since: 0, limit: 2, cursor })
      seen.push(...page.notes.map((n) => n.id))
      cursor = page.next_cursor
      if (!cursor) break
    }

    expect(seen.sort()).toEqual(['a', 'b', 'c'])
  })

  it('groups 只在首页返回，后续页为空数组', async () => {
    await seed('a', 100)
    await seed('b', 200)
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })

    const first = await pull({ since: 0, limit: 1 })
    expect(first.groups.map((g) => g.group_id)).toEqual(['g1'])

    const second = await pull({ since: 0, limit: 1, cursor: first.next_cursor })
    expect(second.groups).toEqual([])
  })

  it('groups 也按 since 增量返回', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '工作' })

    const future = Date.now() + 100_000
    const body = await pull({ since: future })

    expect(body.groups).toEqual([])
  })

  it('分组带回「不上首页信息流」默认值，笔记带回三态覆盖值', async () => {
    await json('/api/groups', 'POST', { group_id: 'g1', name: '归档', hide_from_home: 1 })
    const plain = noteReq()
    await json('/api/notes', 'POST', plain)
    const hidden = noteReq()
    await json('/api/notes', 'POST', { ...hidden, home_hidden: 1 })
    const shown = noteReq()
    await json('/api/notes', 'POST', { ...shown, home_hidden: 0 })

    const body = await pull({ since: 0 })

    expect(body.groups.find((g) => g.group_id === 'g1')?.hide_from_home).toBe(1)
    const meta = (id: string) => body.notes.find((n) => n.id === id)
    // 没设过 = null，表示跟随分组；0 与 1 是显式覆盖
    expect(meta(plain.id)?.home_hidden).toBeNull()
    expect(meta(hidden.id)?.home_hidden).toBe(1)
    expect(meta(shown.id)?.home_hidden).toBe(0)
  })

  it('limit 超过 500 被夹到 500', async () => {
    await seed('a', 100)
    const body = await pull({ since: 0, limit: 9999 })
    expect(body.notes).toHaveLength(1)
  })

  it('非法游标返回 400', async () => {
    const res = await json('/api/sync/pull', 'POST', { since: 0, cursor: '!!!' })
    expect(res.status).toBe(400)
  })

  it('缺少 since 返回 400', async () => {
    const res = await json('/api/sync/pull', 'POST', {})
    expect(res.status).toBe(400)
  })

  it('响应不含正文——正文要另行批量拉取', async () => {
    await seed('a', 100)
    const body = await pull({ since: 0 })

    expect(body.notes[0]).not.toHaveProperty('content')
  })

  it('server_time 不晚于响应之后发生的任何写入——下一轮不会漏掉它们', async () => {
    await seed('a', 100)

    const first = await pull({ since: 0 })

    // 这条笔记在 pull 返回之后才创建，它的 update_time 必须 >= 上一次的 server_time，
    // 否则下一轮以 server_time 为 since 就会把它永久排除。
    const created = noteReq()
    await json('/api/notes', 'POST', created)

    const row = await env.DB.prepare('SELECT update_time FROM note WHERE id = ?')
      .bind(created.id)
      .first<{ update_time: number }>()

    expect(row!.update_time).toBeGreaterThanOrEqual(first.server_time)

    const second = await pull({ since: first.server_time })
    expect(second.notes.map((n) => n.id)).toContain(created.id)
  })
})

