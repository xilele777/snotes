import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { agentAuth, type AgentBindings } from '../agent/auth'
import { handleMcp } from '../agent/mcp'
import { AgentError, AgentService } from '../agent/service'
import type { AgentTool } from '../agent/schemas'

export const agentRoutes = new Hono<AgentBindings>()
agentRoutes.use('/api/agent/v1', agentAuth)
agentRoutes.use('/api/agent/v1/*', agentAuth)
agentRoutes.use('/api/mcp', agentAuth)
for (const path of ['/api/agent/v1', '/api/agent/v1/*', '/api/mcp']) {
  agentRoutes.use(path, bodyLimit({ maxSize: 2_097_152, onError: c => c.json({ error: 'payload_too_large' }, 413) }))
}

agentRoutes.onError((error, c) => {
  if (error instanceof AgentError) return c.json({ error: error.code, ...error.details }, error.status)
  console.error('Agent request failed', error)
  return c.json({ error: 'internal_error' }, 500)
})

agentRoutes.all('/api/mcp', c => handleMcp(c.req.raw, new AgentService(c.env.DB, c.get('agent'))))
agentRoutes.get('/api/agent/v1', c => c.json({ name: 'snotes', api_version: 'v1', mcp: '/api/mcp' }))

const reads: [string, AgentTool][] = [
  ['/api/agent/v1/notebooks', 'list_notebooks'],
  ['/api/agent/v1/notebooks/:notebook_id', 'get_notebook'],
  ['/api/agent/v1/notebooks/:notebook_id/notes', 'search_notes'],
  ['/api/agent/v1/notebooks/:notebook_id/notes/:note_id', 'get_note'],
]
for (const [path, tool] of reads) agentRoutes.get(path, c => {
  const args: Record<string, unknown> = { ...c.req.param() }
  if (tool === 'search_notes') {
    args.query = c.req.query('query')
    const offset = c.req.query('offset')
    if (offset !== undefined) args.offset = Number(offset)
  }
  return new AgentService(c.env.DB, c.get('agent')).execute(tool, args).then(data => c.json(data))
})

const writes: ['post' | 'patch', string, AgentTool][] = [
  ['post', '/api/agent/v1/notebooks/:notebook_id/folders', 'create_folder'],
  ['post', '/api/agent/v1/notebooks/:notebook_id/notes', 'create_note'],
  ['patch', '/api/agent/v1/notebooks/:notebook_id/notes/:note_id', 'update_note'],
  ['post', '/api/agent/v1/notebooks/:notebook_id/notes/:note_id/append', 'append_note'],
]
for (const [method, path, tool] of writes) agentRoutes[method](path, async c => {
  const body: unknown = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AgentError(400, 'invalid_arguments')
  const result = await new AgentService(c.env.DB, c.get('agent')).execute(tool, { ...body, ...c.req.param() })
  return c.json(result)
})

// Keep unknown Agent routes inside this authentication boundary, including methods
// that are not implemented. They must never reach owner-only API middleware.
agentRoutes.all('/api/agent/v1', c => c.json({ error: 'not_found' }, 404))
agentRoutes.all('/api/agent/v1/*', c => c.json({ error: 'not_found' }, 404))
