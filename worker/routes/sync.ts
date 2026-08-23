import { Hono } from 'hono'
import { decodeCursor, encodeCursor } from '../../shared/cursor'
import type { BodiesRequest, BodiesResponse, Group, NoteBody, PullRequest, PullResponse } from '../../shared/types'
import { nowMs, rowToNoteMeta } from '../db'
import type { Env } from '../types'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

export const syncRoutes = new Hono<{ Bindings: Env }>()

syncRoutes.post('/api/sync/pull', async (c) => {
  // 必须在任何查询之前取：它是客户端下一轮的 since，
  // 晚取一毫秒就会在这段窗口里永久漏掉别的设备的写入。
  const serverTime = nowMs()

  const req = await c.req.json<PullRequest>().catch(() => null)

  if (!req || typeof req.since !== 'number' || !Number.isFinite(req.since)) {
    return c.json({ error: 'invalid_since' }, 400)
  }

  const limit = Math.min(Math.max(1, req.limit ?? DEFAULT_LIMIT), MAX_LIMIT)

  let after: { update_time: number; id: string } | null = null
  if (req.cursor) {
    after = decodeCursor(req.cursor)
    if (!after) return c.json({ error: 'invalid_cursor' }, 400)
  }

  const notesQuery = after
    ? c.env.DB.prepare(
        `SELECT * FROM note
         WHERE update_time >= ?
           AND (update_time > ? OR (update_time = ? AND id > ?))
         ORDER BY update_time ASC, id ASC
         LIMIT ?`
      ).bind(req.since, after.update_time, after.update_time, after.id, limit)
    : c.env.DB.prepare(
        `SELECT * FROM note
         WHERE update_time >= ?
         ORDER BY update_time ASC, id ASC
         LIMIT ?`
      ).bind(req.since, limit)

  const { results } = await notesQuery.all<Record<string, unknown>>()
  const notes = results.map(rowToNoteMeta)

  let groups: Group[] = []
  if (!after) {
    const groupRows = await c.env.DB.prepare(
      'SELECT * FROM note_group WHERE update_time >= ? ORDER BY ord ASC, group_id ASC'
    )
      .bind(req.since)
      .all<Record<string, unknown>>()

    groups = groupRows.results.map((row) => ({
      group_id: row.group_id as string,
      name: row.name as string,
      ord: Number(row.ord),
      color: (row.color as string | null) ?? null,
      invalid: Number(row.invalid) === 1 ? 1 : 0,
      update_time: Number(row.update_time),
    }))
  }

  const last = notes.at(-1)
  const next_cursor =
    notes.length === limit && last ? encodeCursor(last.update_time, last.id) : null

  const response: PullResponse = {
    notes,
    groups,
    server_time: serverTime,
    next_cursor,
  }

  return c.json(response)
})

const MAX_BODIES = 50

syncRoutes.post('/api/sync/bodies', async (c) => {
  const req = await c.req.json<BodiesRequest>().catch(() => null)

  if (!req || !Array.isArray(req.ids) || !req.ids.every((id) => typeof id === 'string' && id)) {
    return c.json({ error: 'invalid_ids' }, 400)
  }

  if (req.ids.length > MAX_BODIES) {
    return c.json({ error: 'too_many_ids' }, 400)
  }

  if (req.ids.length === 0) {
    return c.json({ bodies: [] } satisfies BodiesResponse)
  }

  const placeholders = req.ids.map(() => '?').join(', ')
  const { results } = await c.env.DB.prepare(
    `SELECT note_id, content, version FROM note_body WHERE note_id IN (${placeholders})`
  )
    .bind(...req.ids)
    .all<Record<string, unknown>>()

  const bodies: NoteBody[] = results.map((row) => ({
    note_id: row.note_id as string,
    content: (row.content as string) ?? '',
    version: Number(row.version),
  }))

  return c.json({ bodies } satisfies BodiesResponse)
})
