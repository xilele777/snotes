import { Hono } from 'hono'
import type { OpenAggregate, OpensSyncRequest, OpensSyncResponse } from '../../shared/types'
import { nowMs } from '../db'
import type { Env } from '../types'

const MAX_ITEMS = 500

function validRequest(req: OpensSyncRequest | null): req is OpensSyncRequest {
  return !!req
    && typeof req.device_id === 'string' && req.device_id.length > 0
    && typeof req.since === 'number' && Number.isFinite(req.since) && req.since >= 0
    && Array.isArray(req.items) && req.items.length <= MAX_ITEMS
    && req.items.every((item) =>
      item && typeof item.note_id === 'string' && item.note_id.length > 0
      && Number.isInteger(item.count) && item.count >= 0
      && Number.isInteger(item.last_open_time) && item.last_open_time >= 0
    )
}

export const opensRoutes = new Hono<{ Bindings: Env }>()

opensRoutes.post('/api/notes/opens', async (c) => {
  // 游标必须在读之前取，防止查询窗口中的数据永久漏掉。
  const serverTime = nowMs()
  const req = await c.req.json<OpensSyncRequest>().catch(() => null)
  if (!validRequest(req)) return c.json({ error: 'invalid_opens_request' }, 400)

  if (req.items.length > 0) {
    await c.env.DB.batch(req.items.map((item) =>
      c.env.DB.prepare(
        `INSERT INTO note_open (note_id, device_id, count, last_open_time, update_time)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(note_id, device_id) DO UPDATE SET
           count = excluded.count,
           last_open_time = excluded.last_open_time,
           update_time = excluded.update_time`
      ).bind(item.note_id, req.device_id, item.count, item.last_open_time, serverTime)
    ))
  }

  const { results } = await c.env.DB.prepare(
    `SELECT note_id,
            SUM(count) AS others_count,
            MAX(last_open_time) AS others_last_open_time
       FROM note_open
      WHERE device_id != ?
        AND note_id IN (SELECT note_id FROM note_open WHERE update_time >= ?)
      GROUP BY note_id`
  ).bind(req.device_id, req.since).all<Record<string, unknown>>()

  const opens: OpenAggregate[] = results.map((row) => ({
    note_id: row.note_id as string,
    others_count: Number(row.others_count),
    others_last_open_time: Number(row.others_last_open_time),
  }))
  const response: OpensSyncResponse = { opens, server_time: serverTime }
  return c.json(response)
})
