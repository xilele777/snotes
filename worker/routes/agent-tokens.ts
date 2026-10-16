import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { AGENT_PERMISSIONS } from '../../shared/agent'
import { id } from '../agent/schemas'
import { sha256, tokenInfo, TOKEN_FIELDS, type TokenRow } from '../agent/auth'
import type { Env } from '../types'

export const agentTokenRoutes = new Hono<{ Bindings: Env }>()
agentTokenRoutes.use('/api/agent-tokens/*', bodyLimit({ maxSize: 16_384 }))
agentTokenRoutes.use('/api/agent-tokens', bodyLimit({ maxSize: 16_384 }))
agentTokenRoutes.use('/api/agent-tokens*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })

agentTokenRoutes.get('/api/agent-tokens', async c => {
  const rows = await c.env.DB.prepare(`SELECT ${TOKEN_FIELDS} FROM agent_token ORDER BY created_at DESC, id`).all<TokenRow>()
  const books = await c.env.DB.prepare('SELECT id, name FROM knowledge_base WHERE invalid = 0 AND deleted = 0 ORDER BY ord, id').all()
  return c.json({ tokens: rows.results.map(tokenInfo), notebooks: books.results })
})

const createToken = z.object({
  name: z.string().trim().min(1).max(100),
  notebook_ids: z.array(id).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  permissions: z.array(z.enum(AGENT_PERMISSIONS)).min(1).max(3).refine(values => new Set(values).size === values.length),
  expires_at: z.number().int().positive().nullable().optional(),
}).strict()

agentTokenRoutes.post('/api/agent-tokens', async c => {
  const parsed = createToken.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
  const req = parsed.data
  const now = Date.now()
  if (req.expires_at != null && req.expires_at <= now) return c.json({ error: 'invalid_expiry' }, 400)
  const found = await c.env.DB.prepare(`SELECT id FROM knowledge_base WHERE invalid = 0 AND deleted = 0
    AND id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(req.notebook_ids)).all()
  if (found.results.length !== req.notebook_ids.length) return c.json({ error: 'invalid_notebooks' }, 400)
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = `snt_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
  const tokenId = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO agent_token (id, name, token_hash, prefix, notebook_ids_json, permissions_json, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(tokenId, req.name, await sha256(secret), secret.slice(0, 12),
    JSON.stringify(req.notebook_ids), JSON.stringify(req.permissions), now, req.expires_at ?? null).run()
  const row = await c.env.DB.prepare(`SELECT ${TOKEN_FIELDS} FROM agent_token WHERE id = ?`).bind(tokenId).first<TokenRow>()
  return c.json({ token: secret, credential: tokenInfo(row!) }, 201)
})

agentTokenRoutes.delete('/api/agent-tokens/:id', async c => {
  const result = await c.env.DB.prepare('UPDATE agent_token SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?')
    .bind(Date.now(), c.req.param('id')).run()
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404)
})

agentTokenRoutes.get('/api/agent-tokens/activity', async c => {
  const rows = await c.env.DB.prepare(`SELECT o.token_id, t.name AS token_name, o.operation_id, o.action,
    o.notebook_id, o.note_id, o.created_at FROM agent_operation o JOIN agent_token t ON t.id = o.token_id
    ORDER BY o.created_at DESC, o.token_id, o.operation_id LIMIT 50`).all()
  return c.json({ activity: rows.results })
})
