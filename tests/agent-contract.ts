import { expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AgentService } from '../worker/agent/service'
import type { Env } from '../worker/types'
import type { AgentPermission } from '../shared/agent'
import type { Database } from '../worker/storage'

export type AgentTestApi = (path: string, method?: string, body?: unknown, token?: string | null, headers?: Record<string, string>) => Promise<Response>
const ROOT = '/api/agent/v1/notebooks'
const OWNER = 'test-token'
export function agentContract(api: AgentTestApi, environment: () => Env) {
  const book = async () => {
    const id = crypto.randomUUID()
    expect((await api('/api/knowledge-bases', 'POST', { id, name: '资料', description: '', icon: '📚', ord: 0, invalid: 0, operation_id: crypto.randomUUID() }, OWNER)).status).toBe(200)
    return id
  }
  const credential = async (ids: string[], permissions: AgentPermission[] = ['read', 'create', 'update']) => {
    const response = await api('/api/agent-tokens', 'POST', { name: '研究助手', notebook_ids: ids, permissions }, OWNER)
    expect(response.status).toBe(201)
    return response.json() as Promise<{ token: string; credential: { id: string } }>
  }
  const create = (id: string, token: string, content = '# 文档\n\n正文', operation_id: string = crypto.randomUUID(), parent_id?: string) =>
    api(`${ROOT}/${id}/notes`, 'POST', { content, operation_id, ...(parent_id ? { parent_id } : {}) }, token)
  const rpc = (token: string, method: string, params: unknown = {}, id: number | null = 1) => api('/api/mcp', 'POST', {
    jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params,
  }, token, { Accept: 'application/json, text/event-stream' })

  it('returns credentials once, stores only a digest, and keeps Agent and owner APIs separate', async () => {
    const notebook = await book()
    const { token, credential: info } = await credential([notebook])
    expect(token).toMatch(/^snt_[a-f0-9]{64}$/)
    const row = await environment().DB.prepare('SELECT * FROM agent_token WHERE id = ?').bind(info.id).first()
    expect(JSON.stringify(row)).not.toContain(token)
    const listing = await (await api('/api/agent-tokens', 'GET', undefined, OWNER)).json() as { tokens: unknown[] }
    expect(JSON.stringify(listing)).not.toContain(token)
    expect(listing.tokens).toHaveLength(1)
    for (const path of ['/api/agent-tokens', '/api/sync/pull', '/api/notes', '/api/metrics/types']) {
      expect((await api(path, 'POST', {}, token)).status).toBe(401)
      expect((await api(ROOT, 'GET', undefined, token)).status).toBe(200)
    }
    expect((await api(ROOT, 'GET', undefined, OWNER)).status).toBe(401)
    expect((await api(ROOT, 'GET', undefined, null)).status).toBe(401)
    expect((await api(`${ROOT}/unknown/notes`, 'DELETE', undefined, token)).status).toBe(404)
    expect((await api(ROOT, 'GET', undefined, token, { Origin: 'https://untrusted.example' })).status).toBe(403)
    const valid = await api(ROOT, 'GET', undefined, token)
    expect(valid.headers.get('cache-control')).toBe('no-store')
  })

  it('enforces exact notebook scope and independent read/create/update permissions', async () => {
    const a = await book(), b = await book()
    const { token } = await credential([a], ['create'])
    const discovery = await (await api(ROOT, 'GET', undefined, token)).json() as { notebooks: { id: string }[] }
    expect(discovery.notebooks.map(n => n.id)).toEqual([a])
    expect((await create(b, token)).status).toBe(404)
    const created = await (await create(a, token)).json() as { note_id: string }
    expect((await api(`${ROOT}/${a}/notes/${created.note_id}`, 'GET', undefined, token)).status).toBe(403)
    expect((await api(`${ROOT}/${a}/notes/${created.note_id}`, 'PATCH', { content: 'changed', base_version: 1, operation_id: 'no-update' }, token)).status).toBe(403)
    const reader = await credential([a], ['read'])
    expect((await create(a, reader.token)).status).toBe(403)
    expect((await api(`${ROOT}/${b}`, 'GET', undefined, reader.token)).status).toBe(404)
    const other = await credential([b])
    expect((await api(`${ROOT}/${b}/notes/${created.note_id}`, 'GET', undefined, other.token)).status).toBe(404)
    expect((await api(`${ROOT}/${b}/notes/${created.note_id}`, 'PATCH', { content: 'stolen', base_version: 1, operation_id: 'outside' }, other.token)).status).toBe(404)
  })

  it('creates a folder and note atomically, derives metadata, and exposes both through existing sync', async () => {
    const id = await book(), { token } = await credential([id])
    const folder = await (await api(`${ROOT}/${id}/folders`, 'POST', { title: '设计', operation_id: 'folder' }, token)).json() as { node_id: string }
    const response = await create(id, token, '# 接口设计\n\n支持 Agent 写入。', 'document', folder.node_id)
    expect(response.status).toBe(200)
    const note = await response.json() as { note_id: string; version: number; toc_version: number; update_time: number }
    expect(note).toMatchObject({ version: 1, toc_version: 2 })
    expect(note.update_time).toBeGreaterThan(0)
    const toc = await (await api(`${ROOT}/${id}`, 'GET', undefined, token)).json() as { nodes: unknown[] }
    expect(toc.nodes).toContainEqual(expect.objectContaining({ kind: 'note', note_id: note.note_id, parent_id: folder.node_id, title: '接口设计' }))
    const pull = await (await api('/api/sync/pull', 'POST', { since: 0 }, OWNER)).json() as { notes: unknown[] }
    expect(pull.notes).toContainEqual(expect.objectContaining({ id: note.note_id, title: '接口设计', version: 1 }))
    const books = await (await api('/api/knowledge-bases/sync/pull', 'POST', { since: 0 }, OWNER)).json() as { books: unknown[] }
    expect(books.books).toContainEqual(expect.objectContaining({ id, toc_version: 2 }))
    const search = await (await api(`${ROOT}/${id}/notes?query=Agent`, 'GET', undefined, token)).json() as { notes: { id: string }[] }
    expect(search.notes.map(n => n.id)).toEqual([note.note_id])
    const audit = await (await api('/api/agent-tokens/activity', 'GET', undefined, OWNER)).json() as { activity: unknown[] }
    expect(audit.activity).toHaveLength(2)
    expect(JSON.stringify(audit)).not.toContain('支持 Agent 写入')
  })

  it('replays create/append writes exactly once, including concurrent network retries', async () => {
    const id = await book(), { token } = await credential([id])
    const responses = await Promise.all([create(id, token, '# 原文', 'same'), create(id, token, '# 原文', 'same')])
    expect(responses.map(r => r.status)).toEqual([200, 200])
    const a = await responses[0].json() as { note_id: string }
    expect(await responses[1].json()).toEqual(a)
    const endpoint = `${ROOT}/${id}/notes/${a.note_id}/append`
    const args = { content: '追加段落', base_version: 1, operation_id: 'append-once' }
    const appended = await Promise.all([api(endpoint, 'POST', args, token), api(endpoint, 'POST', args, token)])
    expect(appended.map(r => r.status)).toEqual([200, 200])
    const first = await appended[0].json()
    expect(await appended[1].json()).toEqual(first)
    expect(await (await api(endpoint, 'POST', args, token)).json()).toEqual(first)
    expect(await (await create(id, token, '# 原文', 'same')).json()).toEqual(a)
    expect((await create(id, token, '不同正文', 'same')).status).toBe(409)
    const read = await (await api(`${ROOT}/${id}/notes/${a.note_id}`, 'GET', undefined, token)).json()
    expect(read).toMatchObject({ content: '# 原文\n\n追加段落', version: 2 })
    expect((await environment().DB.prepare('SELECT id FROM note').all()).results).toHaveLength(1)
    expect((await environment().DB.prepare('SELECT * FROM agent_operation').all()).results).toHaveLength(2)
  })

  it('rejects stale and concurrent edits without overwriting, preserves history, and never revives trash', async () => {
    const id = await book(), { token } = await credential([id])
    const note = await (await create(id, token, '# 旧正文')).json() as { note_id: string }
    const endpoint = `${ROOT}/${id}/notes/${note.note_id}`
    const responses = await Promise.all(['A', 'B'].map(content => api(endpoint, 'PATCH', { content, base_version: 1, operation_id: content }, token)))
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    const stale = await api(endpoint, 'PATCH', { content: 'stale', base_version: 1, operation_id: 'stale' }, token)
    expect(await stale.json()).toMatchObject({ error: 'version_conflict', current_version: 2 })
    const history = await environment().DB.prepare('SELECT body FROM note_history WHERE note_id = ?').bind(note.note_id).all()
    expect(history.results).toEqual([{ body: '# 旧正文' }])
    expect((await api(`/api/notes/${note.note_id}/trash`, 'POST', {}, OWNER)).status).toBe(200)
    expect((await api(endpoint, 'GET', undefined, token)).status).toBe(404)
    expect((await api(endpoint, 'PATCH', { content: 'restore?', base_version: 2, operation_id: 'trashed' }, token)).status).toBe(404)
  })

  it('merges parallel creates without orphaning notes; invalid destinations write nothing', async () => {
    const id = await book(), { token } = await credential([id])
    expect((await create(id, token, '# 正文', 'invalid-parent', 'absent')).status).toBe(422)
    expect((await environment().DB.prepare('SELECT id FROM note').all()).results).toHaveLength(0)
    const responses = await Promise.all([create(id, token, '# A'), create(id, token, '# B')])
    expect(responses.map(r => r.status)).toEqual([200, 200])
    const toc = await (await api(`${ROOT}/${id}`, 'GET', undefined, token)).json() as { nodes: unknown[] }
    expect(toc.nodes).toHaveLength(2)
    expect((await environment().DB.prepare('SELECT id FROM note').all()).results).toHaveLength(2)
  })

  it('revokes and expires credentials, and rechecks authorization atomically at commit', async () => {
    const id = await book(), c = await credential([id])
    expect((await api(`/api/agent-tokens/${c.credential.id}`, 'DELETE', undefined, OWNER)).status).toBe(200)
    expect((await create(id, c.token)).status).toBe(401)
    const expired = await credential([id])
    await environment().DB.prepare('UPDATE agent_token SET expires_at = 1 WHERE id = ?').bind(expired.credential.id).run()
    expect((await rpc(expired.token, 'tools/list')).status).toBe(401)
    const raced = await credential([id])
    const db = environment().DB
    let intercepted = false
    const wrapped: Database = {
      prepare: sql => db.prepare(sql),
      batch: async statements => {
        if (!intercepted) { intercepted = true; await db.prepare('UPDATE agent_token SET revoked_at = ? WHERE id = ?').bind(Date.now(), raced.credential.id).run() }
        return db.batch(statements)
      },
    }
    const service = new AgentService(wrapped, { id: raced.credential.id, notebook_ids: [id], permissions: ['create'] })
    await expect(service.execute('create_note', { notebook_id: id, content: 'late', operation_id: 'revoked-mid-request' })).rejects.toMatchObject({ status: 401 })
    expect((await db.prepare('SELECT id FROM note').all()).results).toHaveLength(0)
    expect((await db.prepare('SELECT * FROM agent_operation').all()).results).toHaveLength(0)
  })

  it('does not mutate legacy shared notes through a notebook outside scope', async () => {
    const a = await book(), b = await book(), { token } = await credential([a])
    const created = await (await create(a, token)).json() as { note_id: string }
    const nodes = [{ id: 'legacy-ref', parent_id: null, kind: 'note', ord: 0, note_id: created.note_id, title: null }]
    expect((await api(`/api/knowledge-bases/${b}/toc`, 'PUT', { nodes, base_toc_version: 0, operation_id: 'legacy-import', preserve_missing_references: true }, OWNER)).status).toBe(200)
    const edit = await api(`${ROOT}/${a}/notes/${created.note_id}`, 'PATCH', { content: 'changed', base_version: 1, operation_id: 'shared' }, token)
    expect(edit.status).toBe(403)
  })

  it('rolls back notes, directories, clocks and audit if a later transaction statement fails', async () => {
    const id = await book(), c = await credential([id])
    const db = environment().DB
    const before = await db.prepare('SELECT seq FROM knowledge_base_clock').first()
    const wrapped: Database = { prepare: sql => db.prepare(sql), batch: statements => db.batch([
      ...statements, db.prepare("INSERT INTO note_body (note_id, content) VALUES ('nonexistent-fk', 'fail')"),
    ]) }
    const service = new AgentService(wrapped, { id: c.credential.id, notebook_ids: [id], permissions: ['create'] })
    await expect(service.execute('create_note', { notebook_id: id, content: 'rollback', operation_id: 'rollback' })).rejects.toThrow()
    for (const table of ['note', 'note_body', 'agent_operation']) expect((await db.prepare(`SELECT * FROM ${table}`).all()).results).toEqual([])
    expect(await db.prepare('SELECT nodes_json FROM knowledge_base_toc WHERE knowledge_base_id = ?').bind(id).first()).toEqual({ nodes_json: '[]' })
    expect(await db.prepare('SELECT seq FROM knowledge_base_clock').first()).toEqual(before)
    expect((await create(id, c.token, 'retry after rollback', 'rollback')).status).toBe(200)
  })

  it('validates credential grants, write arguments, body size and directory capacity', async () => {
    const id = await book()
    for (const invalid of [
      { name: 'empty', notebook_ids: [], permissions: ['read'] },
      { name: 'wrong', notebook_ids: [id], permissions: ['delete'] },
      { name: 'expired', notebook_ids: [id], permissions: ['read'], expires_at: 1 },
      { name: 'unknown', notebook_ids: ['outside'], permissions: ['read'] },
    ]) expect((await api('/api/agent-tokens', 'POST', invalid, OWNER)).status).toBe(400)
    const { token } = await credential([id])
    expect((await api(`${ROOT}/${id}/notes`, 'POST', { content: 'no ID' }, token)).status).toBe(400)
    expect((await create(id, token, '中'.repeat(400_000))).status).toBe(400)
    expect((await api(`${ROOT}/${id}/notes`, 'POST', { content: 'x'.repeat(2_100_000), operation_id: 'huge' }, token)).status).toBe(413)
    const nodes = Array.from({ length: 1000 }, (_, i) => ({ id: `folder-${i}`, parent_id: null, kind: 'folder', ord: i, note_id: null, title: `Chapter ${i}` }))
    await environment().DB.prepare('UPDATE knowledge_base_toc SET nodes_json = ? WHERE knowledge_base_id = ?').bind(JSON.stringify(nodes), id).run()
    expect((await create(id, token)).status).toBe(422)
    expect((await environment().DB.prepare('SELECT id FROM note').all()).results).toEqual([])
  })

  it('connects with the standard MCP client and carries the credential on every request', async () => {
    const id = await book(), { token } = await credential([id])
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => {
        const request = new Request(input, init)
        const text = await request.text()
        const headers = Object.fromEntries(request.headers)
        return api(new URL(request.url).pathname, request.method, text ? JSON.parse(text) : undefined,
          request.headers.get('Authorization')?.slice(7), headers)
      },
    })
    const client = new Client({ name: 'snotes-integration', version: '1' })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools).toHaveLength(8)
      const result = await client.callTool({ name: 'create_note', arguments: { notebook_id: id, content: '# SDK 客户端', operation_id: 'sdk-test' } })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ notebook_id: id, version: 1 })
    } finally { await client.close() }
  })

  it('supports real MCP initialization, discovery, notifications, calls and structured errors', async () => {
    const id = await book(), { token } = await credential([id])
    const initialized = await rpc(token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'contract-test', version: '1' } })
    expect(initialized.status).toBe(200)
    expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: 'snotes' }, capabilities: { tools: {} } } })
    expect(initialized.headers.has('mcp-session-id')).toBe(false)
    expect((await rpc(token, 'notifications/initialized', {}, null)).status).toBe(202)
    const tools = await (await rpc(token, 'tools/list')).json() as { result: { tools: { name: string }[] } }
    expect(tools.result.tools.map(t => t.name)).toContain('append_note')
    const saved = await (await rpc(token, 'tools/call', { name: 'create_note', arguments: { notebook_id: id, content: '# MCP 文档', operation_id: 'mcp-write' } })).json() as { result: { structuredContent: { note_id: string }; isError?: boolean } }
    expect(saved.result.isError).not.toBe(true)
    expect(saved.result.structuredContent.note_id).toBeTruthy()
    const denied = await (await rpc(token, 'tools/call', { name: 'get_notebook', arguments: { notebook_id: 'other' } })).json()
    expect(denied).toMatchObject({ result: { isError: true } })
    const invalid = await (await rpc(token, 'tools/call', { name: 'create_note', arguments: { notebook_id: id, content: 'missing operation' } })).json()
    expect(invalid).toMatchObject({ result: { isError: true } })
    expect((await api('/api/mcp', 'GET', undefined, token)).status).toBe(405)
  })
}
