import type { MiddlewareHandler } from 'hono'
import type { AgentPermission, AgentTokenInfo } from '../../shared/agent'
import type { Env } from '../types'

export interface AgentIdentity {
  id: string
  notebook_ids: string[]
  permissions: AgentPermission[]
}
export type AgentBindings = { Bindings: Env; Variables: { agent: AgentIdentity } }

export interface TokenRow {
  id: string; name: string; prefix: string; notebook_ids_json: string; permissions_json: string
  created_at: number; expires_at: number | null; revoked_at: number | null; last_used_at: number | null
}
export const TOKEN_FIELDS = 'id, name, prefix, notebook_ids_json, permissions_json, created_at, expires_at, revoked_at, last_used_at'
export function tokenInfo(row: TokenRow): AgentTokenInfo {
  const { notebook_ids_json, permissions_json, ...rest } = row
  return { ...rest, notebook_ids: JSON.parse(notebook_ids_json), permissions: JSON.parse(permissions_json) }
}
export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export const agentAuth: MiddlewareHandler<AgentBindings> = async (c, next) => {
  c.header('Cache-Control', 'no-store')
  const unauthorized = () => {
    c.header('WWW-Authenticate', 'Bearer realm="snotes-agent"')
    return c.json({ error: 'unauthorized' }, 401)
  }
  // Remote MCP clients normally omit Origin. Browser callers must be same-origin.
  const origin = c.req.header('Origin')
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'origin_not_allowed' }, 403)
  const header = c.req.header('Authorization') ?? ''
  const secret = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!/^snt_[a-f0-9]{64}$/.test(secret)) return unauthorized()
  const row = await c.env.DB.prepare(`SELECT ${TOKEN_FIELDS} FROM agent_token
    WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(await sha256(secret), Date.now()).first<TokenRow>()
  if (!row) return unauthorized()
  const info = tokenInfo(row)
  c.set('agent', { id: row.id, notebook_ids: info.notebook_ids, permissions: info.permissions })
  await c.env.DB.prepare('UPDATE agent_token SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)')
    .bind(Date.now(), row.id, Date.now() - 60_000).run()
  return next()
}
