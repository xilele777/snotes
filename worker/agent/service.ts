import { derive } from '../../shared/derive'
import { HISTORY_KEEP, HISTORY_MAX_AGE_MS, shouldSnapshot } from '../../shared/history-rules'
import { validateToc, type TocNode } from '../../shared/knowledge-base'
import type { AgentPermission } from '../../shared/agent'
import type { Database, Statement } from '../storage'
import { sha256, type AgentIdentity } from './auth'
import { agentSchemas, type AgentTool } from './schemas'

export class AgentError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 422, public code: string, public details?: Record<string, unknown>) {
    super(code)
  }
}

interface Notebook {
  id: string; name: string; description: string; icon: string; toc_version: number; nodes_json: string
}
interface Note {
  id: string; title: string; summary: string; content: string; version: number; prop_version: number
  create_time: number; update_time: number
}
interface Operation { request_hash: string; response_json: string }
interface WriteRequest {
  notebook_id: string; operation_id: string; parent_id?: string | null; title?: string
  content?: string; note_id?: string; base_version?: number
}
type WriteTool = 'create_folder' | 'create_note' | 'update_note' | 'append_note'

/** Both HTTP and MCP call this service; authorization never depends on a tool's description. */
export class AgentService {
  constructor(private db: Database, private agent: AgentIdentity) {}

  private permit(permission: AgentPermission) {
    if (!this.agent.permissions.includes(permission)) throw new AgentError(403, 'permission_denied')
  }

  private async notebook(id: string): Promise<Notebook> {
    // Do not reveal the existence of notebooks outside the credential's scope.
    if (!this.agent.notebook_ids.includes(id)) throw new AgentError(404, 'notebook_not_found')
    const row = await this.db.prepare(`SELECT b.id, b.name, b.description, b.icon, b.toc_version, t.nodes_json
      FROM knowledge_base b JOIN knowledge_base_toc t ON t.knowledge_base_id = b.id
      WHERE b.id = ? AND b.invalid = 0 AND b.deleted = 0`).bind(id).first<Notebook>()
    if (!row) throw new AgentError(404, 'notebook_not_found')
    return row
  }

  private async note(book: string, id: string): Promise<Note> {
    const row = await this.db.prepare(`SELECT n.id, n.title, n.summary, n.version, n.prop_version, n.create_time, n.update_time, body.content
      FROM note n JOIN note_body body ON body.note_id = n.id
      WHERE n.id = ? AND n.invalid = 0 AND EXISTS (SELECT 1 FROM knowledge_base_toc t, json_each(t.nodes_json) node
        WHERE t.knowledge_base_id = ? AND json_extract(node.value, '$.note_id') = n.id)`)
      .bind(id, book).first<Note>()
    if (!row) throw new AgentError(404, 'note_not_found')
    return row
  }

  async execute(tool: AgentTool, input: unknown): Promise<Record<string, unknown>> {
    const parsed = agentSchemas[tool].safeParse(input)
    if (!parsed.success) throw new AgentError(400, 'invalid_arguments', { issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })) })
    if (tool === 'list_notebooks') {
      const rows = await this.db.prepare(`SELECT id, name, description, icon, toc_version FROM knowledge_base
        WHERE invalid = 0 AND deleted = 0 AND id IN (SELECT value FROM json_each(?)) ORDER BY ord, id`)
        .bind(JSON.stringify(this.agent.notebook_ids)).all()
      return { notebooks: rows.results, permissions: this.agent.permissions }
    }
    if (tool === 'get_notebook') {
      const { notebook_id } = agentSchemas.get_notebook.parse(input)
      const { nodes_json, ...book } = await this.notebook(notebook_id)
      const notes = await this.db.prepare(`SELECT n.id, n.title, n.version FROM note n
        WHERE n.invalid = 0 AND n.id IN (SELECT json_extract(node.value, '$.note_id')
          FROM knowledge_base_toc t, json_each(t.nodes_json) node WHERE t.knowledge_base_id = ?)`)
        .bind(notebook_id).all<{ id: string; title: string; version: number }>()
      const metadata = new Map(notes.results.map(n => [n.id, n]))
      const nodes = (JSON.parse(nodes_json) as TocNode[]).filter(n => n.kind === 'folder' || metadata.has(n.note_id!)).map(n => ({
        ...n, ...(n.note_id ? { title: metadata.get(n.note_id)!.title, version: metadata.get(n.note_id)!.version } : {}),
      }))
      return { notebook: book, nodes }
    }
    if (tool === 'get_note') {
      this.permit('read')
      const { notebook_id, note_id } = agentSchemas.get_note.parse(input)
      await this.notebook(notebook_id)
      return { notebook_id, ...await this.note(notebook_id, note_id) }
    }
    if (tool === 'search_notes') {
      this.permit('read')
      const { notebook_id, query, offset = 0 } = agentSchemas.search_notes.parse(input)
      await this.notebook(notebook_id)
      const rows = await this.db.prepare(`SELECT n.id, n.title, n.summary, n.version, n.update_time
        FROM note n JOIN note_body body ON body.note_id = n.id WHERE n.invalid = 0
        AND n.id IN (SELECT json_extract(node.value, '$.note_id') FROM knowledge_base_toc t, json_each(t.nodes_json) node WHERE t.knowledge_base_id = ?)
        AND (instr(lower(n.title), lower(?)) > 0 OR instr(lower(body.content), lower(?)) > 0)
        ORDER BY n.update_time DESC, n.id LIMIT 51 OFFSET ?`).bind(notebook_id, query, query, offset).all()
      return { notes: rows.results.slice(0, 50), next_offset: rows.results.length > 50 ? offset + 50 : null }
    }
    const result = await this.write(tool, parsed.data as WriteRequest)
    return { ...result, url: `/?notebook=${result.notebook_id}${result.note_id ? `&note=${result.note_id}` : ''}` }
  }

  private replay(prior: Operation, hash: string): Record<string, unknown> {
    if (prior.request_hash !== hash) throw new AgentError(409, 'operation_reused')
    return JSON.parse(prior.response_json)
  }

  private operation(operationId: string) {
    return this.db.prepare('SELECT request_hash, response_json FROM agent_operation WHERE token_id = ? AND operation_id = ?')
      .bind(this.agent.id, operationId).first<Operation>()
  }

  private async write(kind: WriteTool, req: WriteRequest): Promise<Record<string, unknown>> {
    this.permit(kind.startsWith('create_') ? 'create' : 'update')
    const hash = await sha256(JSON.stringify({ kind, ...req }))
    await this.notebook(req.notebook_id)
    const prior = await this.operation(req.operation_id)
    if (prior) return this.replay(prior, hash)
    // Directory changes are merged against the latest tree. If another request wins,
    // rebuild the small mutation rather than asking the Agent to replace a whole TOC.
    for (let attempt = 0; attempt < 3; attempt++) {
      const book = await this.notebook(req.notebook_id)
      const nodes = JSON.parse(book.nodes_json) as TocNode[]
      const creating = kind === 'create_note' || kind === 'create_folder'
      const now = Date.now()
      const commit = crypto.randomUUID()
      const noteId = kind === 'create_folder' ? null : kind === 'create_note' ? crypto.randomUUID() : req.note_id!
      const nodeId = creating ? crypto.randomUUID() : null
      let current: Note | undefined
      let content = req.content ?? ''
      if (creating) {
        const parent = req.parent_id ?? null
        if (parent !== null && !nodes.some(n => n.id === parent && n.kind === 'folder')) throw new AgentError(422, 'parent_not_found')
        nodes.push({ id: nodeId!, kind: kind === 'create_folder' ? 'folder' : 'note', parent_id: parent,
          ord: nodes.filter(n => n.parent_id === parent).length, note_id: noteId, title: req.title ?? null })
        try { validateToc(nodes) } catch (error) { throw new AgentError(422, 'invalid_directory', { message: (error as Error).message }) }
      } else {
        current = await this.note(book.id, noteId!)
        if (current.version !== req.base_version) {
          // Another copy of the same request may have committed during the reads.
          const raced = await this.operation(req.operation_id)
          if (raced) return this.replay(raced, hash)
          throw new AgentError(409, 'version_conflict', { current_version: current.version })
        }
        // Legacy imports can share a note across books. Never change a note whose
        // other active notebook lies outside this credential's grants.
        const outside = await this.db.prepare(`SELECT 1 AS found FROM knowledge_base b JOIN knowledge_base_toc t ON t.knowledge_base_id = b.id,
          json_each(t.nodes_json) node WHERE b.invalid = 0 AND b.deleted = 0
          AND b.id NOT IN (SELECT value FROM json_each(?)) AND json_extract(node.value, '$.note_id') = ? LIMIT 1`)
          .bind(JSON.stringify(this.agent.notebook_ids), noteId).first()
        if (outside) throw new AgentError(403, 'shared_note_outside_scope')
        if (kind === 'append_note') content = current.content ? `${current.content}\n\n${content}` : content
        if (new TextEncoder().encode(content).length > 1_000_000) throw new AgentError(422, 'note_too_large')
      }
      const derived = derive(content)
      const permission = creating ? 'create' : 'update'
      // Claim the request only if all versions, membership, and credential state
      // still match. The entire batch is a transaction in D1 and SQLite.
      const guards = [`EXISTS (SELECT 1 FROM agent_token WHERE id = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > MAX(?, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))) AND EXISTS (SELECT 1 FROM json_each(notebook_ids_json) WHERE value = ?)
        AND EXISTS (SELECT 1 FROM json_each(permissions_json) WHERE value = ?))`,
      'EXISTS (SELECT 1 FROM knowledge_base WHERE id = ? AND invalid = 0 AND deleted = 0 AND toc_version = ?)']
      const values: unknown[] = [this.agent.id, now, book.id, permission, book.id, book.toc_version]
      if (current) {
        guards.push('EXISTS (SELECT 1 FROM note n JOIN note_body body ON body.note_id = n.id WHERE n.id = ? AND n.invalid = 0 AND n.version = ? AND n.prop_version = ?)')
        values.push(noteId, current.version, current.prop_version)
        guards.push(`NOT EXISTS (SELECT 1 FROM knowledge_base b JOIN knowledge_base_toc t ON t.knowledge_base_id = b.id,
          json_each(t.nodes_json) node WHERE b.invalid = 0 AND b.deleted = 0
          AND b.id NOT IN (SELECT value FROM json_each(?)) AND json_extract(node.value, '$.note_id') = ?)`)
        values.push(JSON.stringify(this.agent.notebook_ids), noteId)
      }
      const marker = 'EXISTS (SELECT 1 FROM agent_operation WHERE commit_id = ?)'
      const statements: Statement[] = [this.db.prepare(`INSERT INTO agent_operation
        (token_id, operation_id, request_hash, commit_id, response_json, action, notebook_id, note_id, created_at)
        SELECT ?, ?, ?, ?, '{}', ?, ?, ?, ? WHERE ${guards.join(' AND ')} ON CONFLICT(token_id, operation_id) DO NOTHING`)
        .bind(this.agent.id, req.operation_id, hash, commit, kind, book.id, noteId, now, ...values)]
      if (kind === 'create_note') {
        statements.push(this.db.prepare(`INSERT INTO note (id, title, summary, thumbnail, create_time, update_time)
          SELECT ?, ?, ?, ?, ?, ? WHERE ${marker}`).bind(noteId, derived.title, derived.summary, derived.thumbnail, now, now, commit),
        this.db.prepare(`INSERT INTO note_body (note_id, content) SELECT ?, ? WHERE ${marker}`).bind(noteId, content, commit))
      }
      if (creating) {
        statements.push(this.db.prepare(`UPDATE knowledge_base_toc SET nodes_json = ?, version = version + 1, update_time = ?, last_operation_id = ?
          WHERE knowledge_base_id = ? AND ${marker}`).bind(JSON.stringify(nodes), now, commit, book.id, commit),
        this.db.prepare(`UPDATE knowledge_base_clock SET seq = seq + 1 WHERE id = 1 AND ${marker}`).bind(commit),
        this.db.prepare(`UPDATE knowledge_base SET toc_version = toc_version + 1, update_time = ?, change_seq = (SELECT seq FROM knowledge_base_clock WHERE id = 1)
          WHERE id = ? AND ${marker}`).bind(now, book.id, commit))
      } else if (current && current.content !== content) {
        const last = await this.db.prepare('SELECT time, body FROM note_history WHERE note_id = ? ORDER BY time DESC, id DESC LIMIT 1')
          .bind(noteId).first<{ time: number; body: string }>()
        if (shouldSnapshot(current.content, content, last ?? undefined, now)) {
          statements.push(this.db.prepare(`INSERT INTO note_history (note_id, time, body) SELECT ?, ?, ? WHERE ${marker}`)
            .bind(noteId, current.update_time, current.content, commit),
          this.db.prepare(`DELETE FROM note_history WHERE note_id = ? AND ${marker} AND (time < ? OR id NOT IN (
            SELECT id FROM note_history WHERE note_id = ? ORDER BY time DESC, id DESC LIMIT ?))`)
            .bind(noteId, commit, now - HISTORY_MAX_AGE_MS, noteId, HISTORY_KEEP))
        }
        statements.push(this.db.prepare(`UPDATE note SET title = ?, summary = ?, thumbnail = ?, version = version + 1, update_time = ?
          WHERE id = ? AND ${marker}`).bind(derived.title, derived.summary, derived.thumbnail, now, noteId, commit),
        this.db.prepare(`UPDATE note_body SET content = ?, version = version + 1 WHERE note_id = ? AND ${marker}`).bind(content, noteId, commit))
      }
      statements.push(this.db.prepare(`UPDATE agent_operation SET response_json = json_object(
        'notebook_id', notebook_id, 'note_id', note_id, 'node_id', ?,
        'version', (SELECT version FROM note WHERE id = note_id),
        'toc_version', (SELECT toc_version FROM knowledge_base WHERE id = notebook_id),
        'update_time', COALESCE((SELECT update_time FROM note WHERE id = note_id), ?)) WHERE commit_id = ?`)
        .bind(nodeId, now, commit))
      await this.db.batch(statements)
      const result = await this.operation(req.operation_id)
      if (result) return this.replay(result, hash)
      const valid = await this.db.prepare('SELECT id FROM agent_token WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)')
        .bind(this.agent.id, Date.now()).first()
      if (!valid) throw new AgentError(401, 'unauthorized')
    }
    throw new AgentError(409, 'write_conflict', { message: 'Read the latest state and retry with the same operation_id and arguments.' })
  }
}
