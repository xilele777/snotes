import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { MAX_TOC_BYTES, validId, validateKnowledgeBaseMeta, validateToc } from '../../shared/knowledge-base'
import type { KnowledgeBase, KnowledgeBaseAck, KnowledgeBaseRemote, TocNode } from '../../shared/knowledge-base'
import type { Database } from '../storage'
import type { Env } from '../types'
import { cleanupDeletedNotebookImages } from '../knowledge-base-deletion'
import { issueCheckpoint, validCheckpoint } from '../sync-checkpoint'

export const knowledgeBasesRoutes = new Hono<{ Bindings: Env }>()
knowledgeBasesRoutes.use('/api/knowledge-bases/*', bodyLimit({ maxSize: MAX_TOC_BYTES + 4096 }))
knowledgeBasesRoutes.use('/api/knowledge-bases', bodyLimit({ maxSize: 8192 }))

const BOOK_FIELDS = 'id, name, description, icon, ord, invalid, deleted, meta_version, toc_version, create_time, update_time, change_seq'
const ACK_FIELDS = 'meta_version, toc_version, update_time'
const absent = 'NOT EXISTS (SELECT 1 FROM knowledge_base_operation WHERE knowledge_base_id = ? AND operation_id = ?)'

async function remote(db: Database, id: string): Promise<KnowledgeBaseRemote | null> {
  // Join metadata and TOC in one statement so concurrent commits cannot produce
  // a metadata projection for one version and a structure for another.
  const row = await db.prepare(`SELECT b.*, t.version AS structure_version, t.nodes_json, t.update_time AS structure_time
    FROM knowledge_base b JOIN knowledge_base_toc t ON t.knowledge_base_id = b.id WHERE b.id = ?`).bind(id)
    .first<KnowledgeBase & { structure_version: number; nodes_json: string; structure_time: number }>()
  if (!row) return null
  const nodes = JSON.parse(row.nodes_json) as TocNode[]
  const noteIds = nodes.flatMap(n => n.note_id ? [n.note_id] : [])
  const note_states: KnowledgeBaseRemote['note_states'] = {}
  // Keep well below both SQLite and D1's per-statement parameter limit.
  for (let i = 0; i < noteIds.length; i += 50) {
    const ids = noteIds.slice(i, i + 50)
    const rows = await db.prepare(`SELECT id, invalid FROM note WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids)
      .all<{ id: string; invalid: number }>()
    const statuses = new Map(rows.results.map(n => [n.id, n.invalid]))
    for (const id of ids) note_states[id] = statuses.get(id) === 0 ? 'available' : statuses.get(id) === 1 ? 'trash' : 'purged'
  }
  const { id: bookId, name, description, icon, ord, invalid, deleted, meta_version, toc_version, create_time, update_time, change_seq } = row
  const deletedNotes = deleted ? (await db.prepare('SELECT note_id FROM knowledge_base_deleted_note WHERE knowledge_base_id = ?').bind(id).all<{ note_id: string }>()).results.map(n => n.note_id) : undefined
  return {
    book: { id: bookId, name, description, icon, ord, invalid, deleted, meta_version, toc_version, create_time, update_time, change_seq },
    toc: { knowledge_base_id: id, version: row.structure_version, nodes, update_time: row.structure_time }, note_states,
    ...(deletedNotes ? { deleted_note_ids: deletedNotes } : {}),
  }
}

async function fingerprint(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
async function operation(db: Database, id: string, op: string) {
  return db.prepare(`SELECT request_json, ${ACK_FIELDS} FROM knowledge_base_operation WHERE knowledge_base_id = ? AND operation_id = ?`)
    .bind(id, op).first<KnowledgeBaseAck & { request_json: string }>()
}
function ack(row: KnowledgeBaseAck): KnowledgeBaseAck {
  return { meta_version: row.meta_version, toc_version: row.toc_version, update_time: row.update_time }
}

/** The clock and ack are in the same atomic batch as the guarded write. */
function finish(db: Database, id: string, op: string, hash: string, guard: string) {
  return [
    db.prepare(`UPDATE knowledge_base_clock SET seq = seq + 1 WHERE id = 1 AND ${guard} AND ${absent}`).bind(id, op, id, op),
    db.prepare(`UPDATE knowledge_base SET change_seq = (SELECT seq FROM knowledge_base_clock WHERE id = 1)
      WHERE id = ? AND ${guard} AND ${absent}`).bind(id, id, op, id, op),
    db.prepare(`INSERT INTO knowledge_base_operation (knowledge_base_id, operation_id, request_json, ${ACK_FIELDS})
      SELECT id, ?, ?, ${ACK_FIELDS} FROM knowledge_base WHERE id = ? AND ${guard} AND ${absent}`)
      .bind(op, hash, id, id, op, id, op),
  ]
}
const metaGuard = 'EXISTS (SELECT 1 FROM knowledge_base WHERE id = ? AND last_operation_id = ?)'
const tocGuard = 'EXISTS (SELECT 1 FROM knowledge_base_toc WHERE knowledge_base_id = ? AND last_operation_id = ?)'

knowledgeBasesRoutes.post('/api/knowledge-bases/sync/checkpoint', async c => {
  const req = await c.req.json().catch(() => null)
  if (!req || !Number.isSafeInteger(req.since) || req.since < 0) return c.json({ error: 'invalid_since' }, 400)
  return c.json({ valid: await validCheckpoint(c.env.DB, req.checkpoint, req.since, 'books', c.env.SYNC_INSTANCE_EPOCH, !!req.require_current) })
})

knowledgeBasesRoutes.post('/api/knowledge-bases/sync/pull', async c => {
  const req = await c.req.json().catch(() => null)
  const since = req?.since ?? 0
  const after = req?.after ?? since
  const clock = (await c.env.DB.prepare('SELECT seq FROM knowledge_base_clock WHERE id = 1').first<{ seq: number }>())!.seq
  const until = req?.until ?? clock
  const receipt = await issueCheckpoint(c.env.DB, until, 'books', c.env.SYNC_INSTANCE_EPOCH)
  if ('checkpoint' in (req ?? {}) && since > 0 && !await validCheckpoint(c.env.DB, req.checkpoint, since, 'books', c.env.SYNC_INSTANCE_EPOCH)) {
    return c.json({ error: 'sync_reset_required' }, 409)
  }
  if (![since, after, until].every(n => Number.isSafeInteger(n) && n >= 0) || after < since || until > clock || since > until) {
    return c.json({ error: 'invalid_cursor' }, 400)
  }
  const inventory = req?.inventory === true
  if (inventory && req.after_id !== undefined && (typeof req.after_id !== 'string' || req.after_id.length > 100)) return c.json({ error: 'invalid_cursor' }, 400)
  const rows = inventory
    ? await c.env.DB.prepare(`SELECT ${BOOK_FIELDS} FROM knowledge_base WHERE id > ? ORDER BY id LIMIT 51`).bind(req.after_id ?? '').all<KnowledgeBase>()
    : await c.env.DB.prepare(`SELECT ${BOOK_FIELDS} FROM knowledge_base
      WHERE change_seq > ? AND change_seq <= ? ORDER BY change_seq LIMIT 51`).bind(after, until).all<KnowledgeBase>()
  const books = rows.results.slice(0, 50)
  return c.json({ books, until, next_after: rows.results.length > 50 ? books.at(-1)!.change_seq : null,
    next_id: inventory && rows.results.length > 50 ? books.at(-1)!.id : null, checkpoint: receipt })
})

knowledgeBasesRoutes.get('/api/knowledge-bases/:id/toc', async c => {
  const result = await remote(c.env.DB, c.req.param('id'))
  return result ? c.json(result) : c.json({ error: 'not_found' }, 404)
})

// Metadata includes recoverable removal; this changes no note or TOC records.
async function writeMeta(c: Context<{ Bindings: Env }>, create: boolean) {
  const req = await c.req.json().catch(() => null)
  const id = create ? req?.id : c.req.param('id')
  const op = req?.operation_id
  const base = create ? 0 : req?.base_meta_version
  if (!validId(id) || !validId(op) || !Number.isSafeInteger(base) || base < 0) return c.json({ error: 'invalid_body' }, 400)
  let meta
  try { meta = validateKnowledgeBaseMeta(req) } catch (e) { return c.json({ error: String(e) }, 400) }
  const hash = await fingerprint({ kind: 'meta', base, meta })
  const existing = await c.env.DB.prepare('SELECT deleted FROM knowledge_base WHERE id = ?').bind(id).first<{ deleted: number }>()
  if (existing?.deleted) return c.json({ error: 'permanently_deleted', current: await remote(c.env.DB, id) }, 410)
  const prior = await operation(c.env.DB, id, op)
  if (prior) return prior.request_json === hash ? c.json(ack(prior)) : c.json({ error: 'operation_reused' }, 400)
  const now = Date.now()
  const db = c.env.DB
  const values = [meta.name, meta.description, meta.icon, meta.ord, meta.invalid]
  const statements = create ? [
    db.prepare(`INSERT INTO knowledge_base (id, name, description, icon, ord, invalid, create_time, update_time, last_operation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(id, ...values, now, now, op),
    db.prepare(`INSERT INTO knowledge_base_toc (knowledge_base_id, update_time)
      SELECT id, ? FROM knowledge_base WHERE id = ? ON CONFLICT(knowledge_base_id) DO NOTHING`).bind(now, id),
  ] : [
    db.prepare(`UPDATE knowledge_base SET name = ?, description = ?, icon = ?, ord = ?, invalid = ?,
      meta_version = meta_version + 1, update_time = ?, last_operation_id = ? WHERE id = ? AND deleted = 0 AND meta_version = ? AND ${absent}`)
      .bind(...values, now, op, id, base, id, op),
  ]
  await db.batch([...statements, ...finish(db, id, op, hash, metaGuard)])
  const result = await operation(db, id, op)
  if (result) return result.request_json === hash ? c.json(ack(result)) : c.json({ error: 'operation_reused' }, 400)
  const current = await remote(db, id)
  return current ? c.json({ error: 'conflict', current }, 409) : c.json({ error: 'not_found' }, 404)
}
knowledgeBasesRoutes.post('/api/knowledge-bases', c => writeMeta(c, true))
knowledgeBasesRoutes.patch('/api/knowledge-bases/:id', c => writeMeta(c, false))

knowledgeBasesRoutes.post('/api/knowledge-bases/:id/delete', async c => {
  const id = c.req.param('id')
  const req = await c.req.json().catch(() => null)
  if (!validId(id) || typeof req?.name !== 'string' || ![req?.base_meta_version, req?.base_toc_version].every(n => Number.isSafeInteger(n) && n >= 0)) return c.json({ error: 'invalid_body' }, 400)
  const db = c.env.DB
  const current = await remote(db, id)
  if (!current) return c.json({ error: 'not_found' }, 404)
  if (req.name !== current.book.name) return c.json({ error: 'name_mismatch' }, 400)
  if (!current.book.deleted) {
    const now = Date.now()
    // All destructive statements share the successful CAS marker in one transaction.
    const marker = crypto.randomUUID()
    const guard = 'EXISTS (SELECT 1 FROM knowledge_base WHERE id = ? AND deleted = 1 AND last_operation_id = ?)'
    const refs = 'SELECT note_id FROM knowledge_base_deleted_note WHERE knowledge_base_id = ?'
    await db.batch([
      db.prepare(`UPDATE knowledge_base SET deleted = 1, invalid = 1, meta_version = meta_version + 1,
        toc_version = toc_version + 1, update_time = ?, last_operation_id = ?
        WHERE id = ? AND deleted = 0 AND name = ? AND meta_version = ? AND toc_version = ?`)
        .bind(now, marker, id, req.name, req.base_meta_version, req.base_toc_version),
      db.prepare(`INSERT OR IGNORE INTO knowledge_base_deleted_note (note_id, knowledge_base_id)
        SELECT json_extract(j.value, '$.note_id'), ? FROM knowledge_base_toc t, json_each(t.nodes_json) j
        WHERE t.knowledge_base_id = ? AND json_extract(j.value, '$.note_id') IS NOT NULL AND ${guard}`).bind(id, id, id, marker),
      db.prepare(`INSERT OR IGNORE INTO knowledge_base_deleted_image (file_key, knowledge_base_id)
        SELECT file_key, ? FROM image WHERE note_id IN (${refs}) AND ${guard}`).bind(id, id, id, marker),
      ...['image', 'note_body', 'note_open', 'note_history'].map(table => db.prepare(`DELETE FROM ${table} WHERE note_id IN (${refs}) AND ${guard}`).bind(id, id, marker)),
      db.prepare(`UPDATE note SET invalid = 2, title = '', summary = '', thumbnail = NULL, prop_version = prop_version + 1, update_time = ?
        WHERE id IN (${refs}) AND ${guard}`).bind(now, id, id, marker),
      db.prepare(`DELETE FROM knowledge_base_toc_history WHERE knowledge_base_id = ? AND ${guard}`).bind(id, id, marker),
      db.prepare(`UPDATE knowledge_base_toc SET nodes_json = '[]', version = version + 1, update_time = ? WHERE knowledge_base_id = ? AND ${guard}`).bind(now, id, id, marker),
      db.prepare(`UPDATE knowledge_base_clock SET seq = seq + 1 WHERE id = 1 AND ${guard}`).bind(id, marker),
      db.prepare(`UPDATE knowledge_base SET change_seq = (SELECT seq FROM knowledge_base_clock WHERE id = 1) WHERE id = ? AND ${guard}`).bind(id, id, marker),
    ])
    const result = await remote(db, id)
    if (!result?.book.deleted) return c.json({ error: 'conflict', current: result }, 409)
  }
  // Failed storage requests retain durable cleanup keys for a retry or maintenance.
  await cleanupDeletedNotebookImages(c.env, id)
  return c.json(await remote(db, id))
})

knowledgeBasesRoutes.put('/api/knowledge-bases/:id/toc', async c => {
  const id = c.req.param('id')
  const req = await c.req.json().catch(() => null)
  const op = req?.operation_id
  const base = req?.base_toc_version
  if (!validId(id) || !validId(op) || !Number.isSafeInteger(base) || base < 0) return c.json({ error: 'invalid_body' }, 400)
  let nodes: TocNode[]
  try { nodes = validateToc(req.nodes) } catch (e) { return c.json({ error: String(e) }, 400) }
  const db = c.env.DB
  const preserveMissing = req.preserve_missing_references === true
  const archivedVersion = req.archived_meta_version ?? -1
  if (!Number.isSafeInteger(archivedVersion) || archivedVersion < -1 || req.preserve_missing_references !== undefined && typeof req.preserve_missing_references !== 'boolean') return c.json({ error: 'invalid_body' }, 400)
  const hash = await fingerprint({ kind: 'toc', base, nodes, preserveMissing, archivedVersion })
  const current = await remote(db, id)
  if (current?.book.deleted) return c.json({ error: 'permanently_deleted', current }, 410)
  const prior = await operation(db, id, op)
  if (prior) return prior.request_json === hash ? c.json(ack(prior)) : c.json({ error: 'operation_reused' }, 400)
  if (!current) return c.json({ error: 'not_found' }, 404)
  if (current.toc.version !== base || current.book.invalid && current.book.meta_version !== archivedVersion) return c.json({ error: 'conflict', current }, 409)
  const oldRefs = new Set(current.toc.nodes.flatMap(n => n.note_id ? [n.note_id] : []))
  // Restore/import can retain missing references as placeholders. This flag
  // never creates, restores or modifies a note's content or lifecycle.
  if (!preserveMissing && nodes.some(n => n.note_id && !oldRefs.has(n.note_id) && current.note_states[n.note_id] !== 'available')) {
    const newIds = nodes.flatMap(n => n.note_id && !oldRefs.has(n.note_id) ? [n.note_id] : [])
    for (let i = 0; i < newIds.length; i += 50) {
      const ids = newIds.slice(i, i + 50)
      const found = await db.prepare(`SELECT id FROM note WHERE invalid = 0 AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>()
      if (found.results.length !== ids.length) return c.json({ error: 'missing_notes' }, 422)
    }
  }
  const newRefs = nodes.flatMap(n => n.note_id && !oldRefs.has(n.note_id) ? [n.note_id] : [])
  // Check within the CAS statement: two devices adding the same note to
  // different notebooks must not both win. Imports retain legacy references.
  const ownershipGuard = preserveMissing || !newRefs.length ? '' : `AND NOT EXISTS (
    SELECT 1 FROM knowledge_base_toc other
    JOIN knowledge_base b ON b.id = other.knowledge_base_id,
      json_each(other.nodes_json) ref, json_each(?) wanted
    WHERE other.knowledge_base_id != ? AND b.invalid = 0 AND b.deleted = 0
      AND json_extract(ref.value, '$.note_id') = wanted.value)`
  const ownershipValues = ownershipGuard ? [JSON.stringify(newRefs), id] : []
  const now = Date.now()
  await db.batch([
    db.prepare(`UPDATE knowledge_base_toc SET version = version + 1, nodes_json = ?, update_time = ?, last_operation_id = ?
      WHERE knowledge_base_id = ? AND version = ? AND EXISTS (SELECT 1 FROM knowledge_base WHERE id = ? AND deleted = 0 AND (invalid = 0 OR meta_version = ?)) AND ${absent} ${ownershipGuard}`)
      .bind(JSON.stringify(nodes), now, op, id, base, id, archivedVersion, id, op, ...ownershipValues),
    db.prepare(`UPDATE knowledge_base SET toc_version = toc_version + 1, update_time = ? WHERE id = ? AND ${tocGuard} AND ${absent}`)
      .bind(now, id, id, op, id, op),
    ...finish(db, id, op, hash, tocGuard),
  ])
  const result = await operation(db, id, op)
  if (result) return result.request_json === hash ? c.json(ack(result)) : c.json({ error: 'operation_reused' }, 400)
  return c.json({ error: 'conflict', current: await remote(db, id) }, 409)
})
