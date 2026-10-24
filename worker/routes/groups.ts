import { Hono } from 'hono'
import { z } from 'zod'
import type { CreateGroupRequest, PatchGroupRequest } from '../../shared/types'
import { nowMs } from '../db'
import type { Env } from '../types'

const PATCH_FIELDS = ['name', 'ord', 'color', 'hide_from_home'] as const

// 类型契约（shared/types.ts）。只查类型与取值，不收紧长度——旧备份导入的分组名
// 可能比 UI 限制长，收紧会把本可同步的数据变成永久 400。
const groupFields = {
  name: z.string().optional(),
  ord: z.number().int().min(0).optional(),
  color: z.string().nullable().optional(),
  hide_from_home: z.union([z.literal(0), z.literal(1)]).optional(),
}
const createGroupSchema = z.object({ group_id: z.string().min(1), ...groupFields, name: z.string() })
const patchGroupSchema = z.object(groupFields)

export const groupsRoutes = new Hono<{ Bindings: Env }>()

groupsRoutes.post('/api/groups', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = createGroupSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
  const req: CreateGroupRequest = parsed.data

  const now = nowMs()

  await c.env.DB.prepare(
    `INSERT INTO note_group (group_id, name, ord, color, hide_from_home, invalid, update_time)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(group_id) DO NOTHING`
  )
    .bind(req.group_id, req.name, req.ord ?? 0, req.color ?? null, req.hide_from_home ?? 0, now)
    .run()

  return c.json({ update_time: now })
})

groupsRoutes.patch('/api/groups/:id', async (c) => {
  const id = c.req.param('id')
  const raw = await c.req.json().catch(() => null)
  const parsed = patchGroupSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
  const req: PatchGroupRequest = parsed.data

  const exists = await c.env.DB.prepare('SELECT group_id FROM note_group WHERE group_id = ?')
    .bind(id)
    .first()
  if (!exists) return c.json({ error: 'not_found' }, 404)

  const touched = PATCH_FIELDS.filter((f) => req[f] !== undefined)
  if (touched.length === 0) return c.json({ error: 'empty_patch' }, 400)

  const now = nowMs()
  const sets = [...touched.map((f) => `${f} = ?`), 'update_time = ?']
  const values = [...touched.map((f) => req[f] ?? null), now]

  await c.env.DB.prepare(`UPDATE note_group SET ${sets.join(', ')} WHERE group_id = ?`)
    .bind(...values, id)
    .run()

  return c.json({ update_time: now })
})

groupsRoutes.delete('/api/groups/:id', async (c) => {
  const id = c.req.param('id')
  const now = nowMs()

  const exists = await c.env.DB.prepare('SELECT group_id FROM note_group WHERE group_id = ?')
    .bind(id)
    .first()
  if (!exists) return c.json({ error: 'not_found' }, 404)

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE note_group SET invalid = 1, update_time = ? WHERE group_id = ?').bind(
      now,
      id
    ),
    c.env.DB.prepare(
      `UPDATE note SET group_id = NULL, prop_version = prop_version + 1, update_time = ?
       WHERE group_id = ?`
    ).bind(now, id),
  ])

  return c.json({ update_time: now })
})
