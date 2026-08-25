import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PullResponse } from '../../shared/types'
import { json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

async function seed(id: string, updateTime: number, over: Record<string, unknown> = {}) {
  await env.DB.prepare(
    `INSERT INTO note (id, title, summary, version, prop_version, invalid, create_time, update_time)
     VALUES (?, ?, '', ?, ?, ?, 1, ?)`
  )
    .bind(id, over.title ?? id, over.version ?? 1, over.prop_version ?? 1, over.invalid ?? 0, updateTime)
    .run()
  await env.DB.prepare('INSERT INTO note_body (note_id, content, version) VALUES (?, ?, ?)')
    .bind(id, `正文-${id}`, over.version ?? 1)
    .run()
}

async function pull(body: Record<string, unknown>) {
  const res = await json('/api/sync/pull', 'POST', body)
  return res.json<PullResponse>()
}

describe('POST /api/sync/pull', () => {
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

