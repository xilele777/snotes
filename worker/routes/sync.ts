import { Hono } from 'hono'
import { decodeCursor, encodeCursor } from '../../shared/cursor'
import type { BodiesRequest, BodiesResponse, Group, NoteBody, PullRequest, PullResponse } from '../../shared/types'
import { rowToNoteMeta } from '../db'
import { parseTrashRetentionDays } from '../maintenance'
import type { Env } from '../types'
import { instanceEpoch, issueCheckpoint, validCheckpoint } from '../sync-checkpoint'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

export const syncRoutes = new Hono<{ Bindings: Env }>()
syncRoutes.get('/api/sync/instance', async c => c.json({ epoch: await instanceEpoch(c.env.DB, c.env.SYNC_INSTANCE_EPOCH) }))

syncRoutes.post('/api/sync/checkpoint', async c => {
  const req = await c.req.json().catch(() => null)
  if (!req || !Number.isSafeInteger(req.since) || req.since < 0) return c.json({ error: 'invalid_since' }, 400)
  const clock = await c.env.DB.prepare('SELECT watermark FROM note_sync_clock WHERE id = 1').first<{ watermark: number }>()
  return c.json({ valid: !!clock && (req.require_current ? req.since === clock.watermark : req.since <= clock.watermark) && await validCheckpoint(c.env.DB, req.checkpoint, req.since, 'notes', c.env.SYNC_INSTANCE_EPOCH, !!req.require_current) })
})

syncRoutes.post('/api/sync/pull', async (c) => {
  // Read the durable watermark before querying rows. A write committing after
  // this read receives a strictly newer timestamp, even if its request started
  // earlier or an application clock moves backwards.
  const clock = await c.env.DB.prepare('SELECT watermark FROM note_sync_clock WHERE id = 1').first<{ watermark: number }>()
  if (!clock) throw new Error('Missing note sync clock; apply database migrations')
  const serverTime = clock.watermark
  const receipt = await issueCheckpoint(c.env.DB, serverTime, 'notes', c.env.SYNC_INSTANCE_EPOCH)

  const req = await c.req.json<PullRequest>().catch(() => null)

  if (!req || !Number.isSafeInteger(req.since) || req.since < 0) {
    return c.json({ error: 'invalid_since' }, 400)
  }
  if ('checkpoint' in req && req.since > 0 && (req.since > serverTime || !await validCheckpoint(c.env.DB, req.checkpoint, req.since, 'notes', c.env.SYNC_INSTANCE_EPOCH))) {
    return c.json({ error: 'sync_reset_required' }, 409)
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
      hide_from_home: Number(row.hide_from_home) === 1 ? 1 : 0,
      invalid: Number(row.invalid) === 1 ? 1 : 0,
      update_time: Number(row.update_time),
    }))
  }

  const last = notes.at(-1)
  const next_cursor =
    notes.length === limit && last ? encodeCursor(last.update_time, last.id) : null

  // 回收站保留天数是部署级配置，客户端只用来在回收站页给出「N 天后自动删除」的提示。
  // 配置非法时维护任务会报错，这里按「未知」处理，不让 pull 跟着失败。
  let trashRetentionDays: number | null = null
  try { trashRetentionDays = parseTrashRetentionDays(c.env.TRASH_RETENTION_DAYS) } catch { trashRetentionDays = null }

  const response: PullResponse = {
    notes,
    groups,
    server_time: serverTime,
    next_cursor,
    trash_retention_days: trashRetentionDays,
    checkpoint: receipt,
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
