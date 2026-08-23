import { Hono } from 'hono'
import type { CreateGroupRequest, PatchGroupRequest } from '../../shared/types'
import { nowMs } from '../db'
import type { Env } from '../types'

const PATCH_FIELDS = ['name', 'ord', 'color'] as const

export const groupsRoutes = new Hono<{ Bindings: Env }>()

groupsRoutes.post('/api/groups', async (c) => {
  const req = await c.req.json<CreateGroupRequest>().catch(() => null)

  if (!req || typeof req.group_id !== 'string' || typeof req.name !== 'string') {
    return c.json({ error: 'invalid_body' }, 400)
  }

  const now = nowMs()

  await c.env.DB.prepare(
    `INSERT INTO note_group (group_id, name, ord, color, invalid, update_time)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(group_id) DO NOTHING`
  )
    .bind(req.group_id, req.name, req.ord ?? 0, req.color ?? null, now)
    .run()

  return c.json({ update_time: now })
})

groupsRoutes.patch('/api/groups/:id', async (c) => {
  const id = c.req.param('id')
  const req = await c.req.json<PatchGroupRequest>().catch(() => null)
  if (!req) return c.json({ error: 'invalid_body' }, 400)

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
