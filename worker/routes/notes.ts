import { Hono } from 'hono'
import type { CreateNoteRequest, PatchNoteRequest } from '../../shared/types'
import { nowMs } from '../db'
import type { Env } from '../types'

const PROP_FIELDS = ['group_id', 'star', 'top', 'skin_color'] as const
const BODY_FIELDS = ['content', 'title', 'summary', 'thumbnail'] as const

export const notesRoutes = new Hono<{ Bindings: Env }>()

notesRoutes.post('/api/notes', async (c) => {
  const req = await c.req.json<CreateNoteRequest>().catch(() => null)

  if (
    !req ||
    typeof req.id !== 'string' ||
    typeof req.create_time !== 'number' ||
    typeof req.content !== 'string' ||
    typeof req.title !== 'string' ||
    typeof req.summary !== 'string'
  ) {
    return c.json({ error: 'invalid_body' }, 400)
  }

  const now = nowMs()

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO note (id, group_id, title, summary, thumbnail, version, prop_version,
                         star, top, skin_color, invalid, create_time, update_time)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).bind(
      req.id,
      req.group_id ?? null,
      req.title,
      req.summary,
      req.thumbnail ?? null,
      req.star ?? 0,
      req.top ?? 0,
      req.skin_color ?? null,
      req.create_time,
      now
    ),
    c.env.DB.prepare(
      `INSERT INTO note_body (note_id, content, version) VALUES (?, ?, 1)
       ON CONFLICT(note_id) DO NOTHING`
    ).bind(req.id, req.content),
  ])

  const row = await c.env.DB.prepare('SELECT version, prop_version, update_time FROM note WHERE id = ?')
    .bind(req.id)
    .first<{ version: number; prop_version: number; update_time: number }>()

  return c.json({
    id: req.id,
    version: row!.version,
    prop_version: row!.prop_version,
    update_time: row!.update_time,
  })
})

notesRoutes.patch('/api/notes/:id', async (c) => {
  const id = c.req.param('id')
  const req = await c.req.json<PatchNoteRequest>().catch(() => null)
  if (!req) return c.json({ error: 'invalid_body' }, 400)

  const current = await c.env.DB.prepare('SELECT version, prop_version FROM note WHERE id = ?')
    .bind(id)
    .first<{ version: number; prop_version: number }>()

  if (!current) return c.json({ error: 'not_found' }, 404)

  const touchesBody = req.content !== undefined
  const touchedProps = PROP_FIELDS.filter((f) => req[f] !== undefined)

  if (!touchesBody && touchedProps.length === 0) {
    return c.json({ error: 'empty_patch' }, 400)
  }

  if (touchesBody && (typeof req.title !== 'string' || typeof req.summary !== 'string')) {
    return c.json({ error: 'derived_fields_required' }, 400)
  }

  // 规格 §7.2：提交 content 必带 base_version，只改属性必带 base_prop_version。
  // 允许缺省会让「没带基线」和「基线恰好等于当前版本」变成同一种情况，
  // 冲突检测因此在客户端漏发字段时静默失效——那正是最需要它的时候。
  if (touchesBody && typeof req.base_version !== 'number') {
    return c.json({ error: 'base_version_required' }, 400)
  }

  if (touchedProps.length > 0 && typeof req.base_prop_version !== 'number') {
    return c.json({ error: 'base_prop_version_required' }, 400)
  }

  const conflicted =
    (touchesBody && req.base_version! < current.version) ||
    (touchedProps.length > 0 && req.base_prop_version! < current.prop_version)

  const now = nowMs()
  const version = touchesBody ? current.version + 1 : current.version
  const propVersion = touchedProps.length > 0 ? current.prop_version + 1 : current.prop_version

  const sets: string[] = ['update_time = ?', 'version = ?', 'prop_version = ?']
  const values: unknown[] = [now, version, propVersion]

  if (touchesBody) {
    for (const f of BODY_FIELDS) {
      if (f === 'content') continue
      sets.push(`${f} = ?`)
      values.push(req[f] ?? null)
    }
  }

  for (const f of touchedProps) {
    sets.push(`${f} = ?`)
    values.push(req[f] ?? null)
  }

  const statements = [
    c.env.DB.prepare(`UPDATE note SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id),
  ]

  if (touchesBody) {
    statements.push(
      c.env.DB.prepare('UPDATE note_body SET content = ?, version = ? WHERE note_id = ?').bind(
        req.content,
        version,
        id
      )
    )
  }

  await c.env.DB.batch(statements)

  return c.json({ version, prop_version: propVersion, update_time: now, conflicted })
})
