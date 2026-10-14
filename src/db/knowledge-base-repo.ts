import { childrenOf, descendantsOf, moveTocNode, validateKnowledgeBaseMeta, validateToc } from '../../shared/knowledge-base'
import type { KnowledgeBase, KnowledgeBaseAck, KnowledgeBaseMeta, KnowledgeBaseRemote, TocNode } from '../../shared/knowledge-base'
import { db } from './schema'
import type { KnowledgeBaseTask } from './knowledge-base-types'
import { emitLocalWrite, emitRemoteApplied } from '../sync/signal'

export const knowledgeBaseTables = () => [db.knowledgeBases, db.knowledgeBaseTocs, db.knowledgeBaseOutbox, db.knowledgeBaseTocHistory, db.knowledgeBaseNoteStates]
export const taskId = (id: string, kind: 'meta' | 'toc') => `${id}:${kind}`
export function metadata(book: KnowledgeBase): KnowledgeBaseMeta {
  return { name: book.name, description: book.description, icon: book.icon, ord: book.ord, invalid: book.invalid }
}

async function enqueueIn(book: KnowledgeBase, kind: 'meta' | 'toc', payload: KnowledgeBaseTask['payload']) {
  const id = taskId(book.id, kind)
  const old = await db.knowledgeBaseOutbox.get(id)
  await db.knowledgeBaseOutbox.put({
    id, book_id: book.id, kind, seq: (old?.seq ?? 0) + 1,
    base_version: old?.base_version ?? (kind === 'meta' ? book.meta_version : book.toc_version),
    operation_id: crypto.randomUUID(), payload,
    ...(old?.preserve_missing_references ? { preserve_missing_references: true } : {}),
    retry: 0, next_at: 0, blocked: old?.blocked ?? false, error: old?.error ?? null,
    ...(old?.sent ? { sent: old.sent } : {}), ...(old?.conflict ? { conflict: old.conflict } : {}),
  })
}

export async function createKnowledgeBase(meta: KnowledgeBaseMeta, id: string = crypto.randomUUID(), nodes: TocNode[] = [], imported = false): Promise<KnowledgeBase> {
  const clean = validateKnowledgeBaseMeta(meta)
  const structure = validateToc(nodes)
  const now = Date.now()
  const book: KnowledgeBase = { ...clean, id, meta_version: 0, toc_version: 0, create_time: now, update_time: now, change_seq: 0 }
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    await db.knowledgeBases.add(book)
    await db.knowledgeBaseTocs.add({ knowledge_base_id: id, version: 0, nodes: structure, update_time: now })
    await enqueueIn(book, 'meta', metadata(book))
    if (structure.length) {
      await enqueueIn(book, 'toc', structure)
      if (imported) await db.knowledgeBaseOutbox.update(taskId(id, 'toc'), { preserve_missing_references: true })
    }
  })
  emitLocalWrite()
  return book
}

export async function updateKnowledgeBase(id: string, patch: Partial<KnowledgeBaseMeta>) {
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    const book = await db.knowledgeBases.get(id)
    if (!book) throw new Error('知识库不存在')
    Object.assign(book, validateKnowledgeBaseMeta({ ...metadata(book), ...patch }), { update_time: Date.now() })
    await db.knowledgeBases.put(book)
    await enqueueIn(book, 'meta', metadata(book))
  })
  emitLocalWrite()
}

export async function changeToc(id: string, change: (nodes: TocNode[]) => TocNode[], preserveMissing = false) {
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    const book = await db.knowledgeBases.get(id)
    const toc = await db.knowledgeBaseTocs.get(id)
    if (!book || !toc || book.invalid) throw new Error('知识库不可用')
    const nodes = validateToc(change(toc.nodes))
    for (const parent of new Set(nodes.map(n => n.parent_id))) childrenOf(nodes, parent).forEach((n, ord) => { n.ord = ord })
    const time = Date.now()
    await db.knowledgeBaseTocs.put({ ...toc, nodes, update_time: time })
    await db.knowledgeBases.update(id, { update_time: time })
    await enqueueIn(book, 'toc', nodes)
    if (preserveMissing) await db.knowledgeBaseOutbox.update(taskId(id, 'toc'), { preserve_missing_references: true })
  })
  emitLocalWrite()
}

export async function addKnowledgeBaseNode(id: string, node: Pick<TocNode, 'kind' | 'note_id' | 'title'>, parent: string | null = null) {
  const nodeId = crypto.randomUUID()
  await changeToc(id, nodes => [...nodes, { ...node, id: nodeId, parent_id: parent, ord: childrenOf(nodes, parent).length }])
  return nodeId
}
export async function removeKnowledgeBaseNode(id: string, nodeId: string) {
  await changeToc(id, nodes => { const removed = descendantsOf(nodes, nodeId); return nodes.filter(n => !removed.has(n.id)) })
}
export async function moveKnowledgeBaseNode(id: string, nodeId: string, parent: string | null, position: number) {
  await changeToc(id, nodes => moveTocNode(nodes, nodeId, parent, position))
}

/** Called inside a transaction; unresolved conflict snapshots are never pruned. */
export async function snapshotIn(id: string, nodes: TocNode[], source: 'confirmed' | 'conflict' | 'discarded', meta?: KnowledgeBaseMeta) {
  await db.knowledgeBaseTocHistory.add({ id: crypto.randomUUID(), book_id: id, time: Date.now(), nodes, source, ...(meta ? { meta } : {}) })
  if (source === 'confirmed') {
    const rows = (await db.knowledgeBaseTocHistory.where('book_id').equals(id).toArray())
      .filter(r => r.source === 'confirmed').sort((a, b) => b.time - a.time || b.id.localeCompare(a.id))
    await db.knowledgeBaseTocHistory.bulkDelete(rows.slice(50).map(r => r.id))
  }
}

export async function applyKnowledgeBaseRemote(remote: KnowledgeBaseRemote) {
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    const id = remote.book.id
    const local = await db.knowledgeBases.get(id)
    const metaTask = await db.knowledgeBaseOutbox.get(taskId(id, 'meta'))
    const tocTask = await db.knowledgeBaseOutbox.get(taskId(id, 'toc'))
    const toc = await db.knowledgeBaseTocs.get(id)
    // A pull never resolves or overwrites an unacknowledged local change.
    if (!metaTask && (!local || remote.book.meta_version >= local.meta_version)) {
      await db.knowledgeBases.put({ ...remote.book, toc_version: tocTask ? local?.toc_version ?? 0 : remote.toc.version,
        // A remote removal cannot silently turn a pending local edit into an
        // intentional archived write. Keep it visible until the CAS conflict.
        invalid: tocTask && local?.invalid === 0 && remote.book.invalid === 1 ? 0 : remote.book.invalid,
      })
    }
    if (!tocTask && (!toc || remote.toc.version >= toc.version)) {
      if (toc && remote.toc.version > toc.version) await snapshotIn(id, toc.nodes, 'confirmed')
      await db.knowledgeBaseTocs.put(remote.toc)
      await db.knowledgeBases.update(id, { toc_version: remote.toc.version })
    }
    await db.knowledgeBaseNoteStates.bulkPut(Object.entries(remote.note_states).map(([id, state]) => ({ id, state })))
  })
}

export async function acknowledgeKnowledgeBaseTask(task: KnowledgeBaseTask, result: KnowledgeBaseAck) {
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    const current = await db.knowledgeBaseOutbox.get(task.id)
    const sent = task.sent!
    if (!current || current.sent?.operation_id !== sent.operation_id) return
    const version = task.kind === 'meta' ? result.meta_version : result.toc_version
    const book = await db.knowledgeBases.get(task.book_id)
    if (!book) return
    const versionField = task.kind === 'meta' ? 'meta_version' : 'toc_version'
    await db.knowledgeBases.update(book.id, { [versionField]: version })
    if (task.kind === 'toc') {
      await db.knowledgeBaseTocs.update(book.id, { version })
      await snapshotIn(book.id, sent.payload as TocNode[], 'confirmed')
    }
    if (current.seq === sent.seq) {
      await db.knowledgeBaseOutbox.delete(task.id)
    } else {
      // A newer edit survives an old response and starts from its confirmed version.
      const { sent: _sent, ...rest } = current
      await db.knowledgeBaseOutbox.put({ ...rest, base_version: version, operation_id: crypto.randomUUID(), retry: 0, next_at: 0, error: null })
    }
  })
}

export async function blockKnowledgeBaseConflict(task: KnowledgeBaseTask, current: KnowledgeBaseRemote) {
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    const row = await db.knowledgeBaseOutbox.get(task.id)
    if (!row || row.sent?.operation_id !== task.sent?.operation_id) return
    const toc = await db.knowledgeBaseTocs.get(task.book_id)
    const book = await db.knowledgeBases.get(task.book_id)
    await snapshotIn(task.book_id, toc?.nodes ?? [], 'conflict', book ? metadata(book) : undefined)
    await snapshotIn(task.book_id, current.toc.nodes, 'conflict', metadata(current.book))
    await db.knowledgeBaseOutbox.put({ ...row, blocked: true, error: '另一台设备修改了知识库，请选择要保留的内容', conflict: current })
  })
  emitRemoteApplied()
}

export async function resolveKnowledgeBaseConflict(id: string, kind: 'meta' | 'toc', choice: 'local' | 'remote') {
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    const row = await db.knowledgeBaseOutbox.get(taskId(id, kind))
    if (!row?.conflict) return
    const remote = row.conflict
    const book = await db.knowledgeBases.get(id)
    const toc = await db.knowledgeBaseTocs.get(id)
    if (!book || !toc) return
    await snapshotIn(id, toc.nodes, 'discarded', metadata(book))
    const version = kind === 'meta' ? remote.book.meta_version : remote.toc.version
    if (choice === 'remote') {
      if (kind === 'meta') await db.knowledgeBases.put({ ...book, ...metadata(remote.book), meta_version: version })
      else {
        await db.knowledgeBaseTocs.put(remote.toc)
        const metaTask = await db.knowledgeBaseOutbox.get(taskId(id, 'meta'))
        await db.knowledgeBases.update(id, { toc_version: version, ...(!metaTask ? { invalid: remote.book.invalid, meta_version: remote.book.meta_version } : {}) })
      }
      await db.knowledgeBaseOutbox.delete(row.id)
    } else {
      // If a remote removal caused the TOC conflict, explicitly recover metadata
      // as well. It will sync before this structure; no note is recreated.
      if (kind === 'toc' && remote.book.invalid) {
        await db.knowledgeBases.update(id, { invalid: 0, meta_version: remote.book.meta_version })
        await enqueueIn({ ...book, meta_version: remote.book.meta_version, invalid: 0 }, 'meta', { ...metadata(book), invalid: 0 })
      }
      const { sent: _sent, conflict: _conflict, ...rest } = row
      await db.knowledgeBaseOutbox.put({ ...rest, base_version: version, seq: row.seq + 1, operation_id: crypto.randomUUID(),
        ...(kind === 'toc' ? { preserve_missing_references: true } : {}),
        payload: kind === 'meta' ? metadata(book) : toc.nodes, blocked: false, error: null, retry: 0, next_at: 0 })
      if (kind === 'meta') await db.knowledgeBases.update(id, { meta_version: version })
      else { await db.knowledgeBaseTocs.update(id, { version }); await db.knowledgeBases.update(id, { toc_version: version }) }
    }
  })
  emitLocalWrite()
  emitRemoteApplied()
}
