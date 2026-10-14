import { Hono } from 'hono'
import type { OpenAggregate, OpensSyncRequest, OpensSyncResponse } from '../../shared/types'
import { nowMs } from '../db'
import type { Env } from '../types'

const MAX_ITEMS = 500
/**
 * want 会变成 SQL 里的占位符，必须给 D1 的「单条查询最多 100 个绑定参数」留出余量
 * （device_id 与 since 各占一个）。客户端也按同一个上限分批点名，超出的下一次再问。
 */
const MAX_WANT = 90

function validIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_WANT
    && value.every((id) => typeof id === 'string' && id.length > 0)
}

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
    // want 是可选的（旧客户端不发）；发了就必须合法，否则宁可直接报错
    && (req.want === undefined || validIds(req.want))
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

  // 两条来源合并：
  //  1. update_time >= since —— 上次同步之后变过的聚合，增量补齐；
  //  2. want 里点名的笔记 —— 本设备第一次见到它们，别的设备的旧计数早已落在
  //     since 之前，只能显式点名。两条都用 device_id != ? 排除本设备自己。
  const want = [...new Set(req.want ?? [])]
  const wantClause = want.length > 0
    ? `OR note_id IN (${want.map(() => '?').join(', ')})`
    : ''

  const { results } = await c.env.DB.prepare(
    `SELECT note_id,
            SUM(count) AS others_count,
            MAX(last_open_time) AS others_last_open_time
       FROM note_open
      WHERE device_id != ?
        AND (note_id IN (SELECT note_id FROM note_open WHERE update_time >= ?) ${wantClause})
      GROUP BY note_id`
  ).bind(req.device_id, req.since, ...want).all<Record<string, unknown>>()

  const opens: OpenAggregate[] = results.map((row) => ({
    note_id: row.note_id as string,
    others_count: Number(row.others_count),
    others_last_open_time: Number(row.others_last_open_time),
  }))

  // 点名要过、但一条别的设备的记录都没有的笔记，服务端要明确回一个 0：
  // 客户端靠「有没有收到回答」把这条笔记标记成「聚合值已知」，否则它会一直
  // 被当成待问的笔记重复点名。返回 0 是真实答案——确实没有别的设备打开过。
  const answered = new Set(opens.map((open) => open.note_id))
  for (const id of want) {
    if (!answered.has(id)) opens.push({ note_id: id, others_count: 0, others_last_open_time: 0 })
  }

  const response: OpensSyncResponse = { opens, server_time: serverTime }
  return c.json(response)
})
