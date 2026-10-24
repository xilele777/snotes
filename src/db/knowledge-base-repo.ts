import { childrenOf, descendantsOf, moveTocNode, validateKnowledgeBaseMeta, validateToc } from '../../shared/knowledge-base'
import type { KnowledgeBase, KnowledgeBaseAck, KnowledgeBaseMeta, KnowledgeBaseRemote, TocNode } from '../../shared/knowledge-base'
import { db } from './schema'
import type { KnowledgeBaseTask } from './knowledge-base-types'
import { emitLocalWrite, emitRemoteApplied } from '../sync/signal'
import { ApiError, apiFetch } from '../api/client'
import { createConflictCopy, trashNote } from './repo'

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

async function assertUnownedIn(bookId: string, noteIds: string[]) {
  if (!noteIds.length) return
  const active = new Set((await db.knowledgeBases.toArray()).filter(b => !b.invalid && !b.deleted && b.id !== bookId).map(b => b.id))
  const requested = new Set(noteIds)
  const otherTocs = await db.knowledgeBaseTocs.toArray()
  if (otherTocs.some(t => active.has(t.knowledge_base_id) && t.nodes.some(n => n.note_id && requested.has(n.note_id)))) {
    throw new Error('笔记已属于其他笔记本，请刷新后重试')
  }
}

export async function createKnowledgeBase(meta: KnowledgeBaseMeta, id: string = crypto.randomUUID(), nodes: TocNode[] = [], imported = false): Promise<KnowledgeBase> {
  const clean = validateKnowledgeBaseMeta(meta)
  const structure = validateToc(nodes)
  const now = Date.now()
  const book: KnowledgeBase = { ...clean, id, meta_version: 0, toc_version: 0, create_time: now, update_time: now, change_seq: 0 }
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    // Legacy imports preserve their existing references without silently dropping data.
    if (!imported) await assertUnownedIn(id, structure.flatMap(n => n.note_id ? [n.note_id] : []))
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
    if (!book || book.deleted) throw new Error('笔记本不存在或已永久删除')
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
    if (!book || !toc || book.invalid) throw new Error('笔记本不可用')
    const nodes = validateToc(change(toc.nodes))
    // Serialize ownership checks with TOC writes, including stale pickers in other tabs.
    const previous = new Set(toc.nodes.flatMap(n => n.note_id ? [n.note_id] : []))
    await assertUnownedIn(id, nodes.flatMap(n => n.note_id && !previous.has(n.note_id) ? [n.note_id] : []))
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
/** Soft deletion keeps directory ownership and placement for recovery. */
export async function trashKnowledgeBaseNode(id: string, nodeId: string, expectedNodes: TocNode[]) {
  await db.transaction('rw', [...knowledgeBaseTables(), db.notes, db.outbox], async () => {
    const book = await db.knowledgeBases.get(id)
    const toc = await db.knowledgeBaseTocs.get(id)
    if (!book || book.invalid || book.deleted || !toc) throw new Error('笔记本不可用')
    if (JSON.stringify(toc.nodes) !== JSON.stringify(expectedNodes)) throw new Error('目录已更新，请重新确认删除')
    const removed = descendantsOf(toc.nodes, nodeId)
    const ids = [...new Set(toc.nodes.flatMap(n => removed.has(n.id) && n.note_id ? [n.note_id] : []))]
    const purged = new Set<string>()
    // Do not claim success if referenced content has not arrived on this device.
    for (const noteId of ids) {
      const note = await db.notes.get(noteId)
      if (note?.invalid === 2 || !note && (await db.knowledgeBaseNoteStates.get(noteId))?.state === 'purged') {
        purged.add(noteId)
        continue
      }
      if (!note) throw new Error('笔记尚未同步到本机，请同步后重试')
      if (note?.invalid === 0) await trashNote(noteId)
    }
    // Only recoverable content needs its original placement. Explicitly deleting
    // stale purged references must actually remove them and sync the TOC change.
    if (ids.length === purged.size) await removeKnowledgeBaseNode(id, nodeId)
    else if (purged.size) await changeToc(id, nodes => nodes.filter(n => !removed.has(n.id) || !n.note_id || !purged.has(n.note_id)))
  })
  emitLocalWrite()
}

export async function moveKnowledgeBaseNode(id: string, nodeId: string, parent: string | null, position: number) {
  await changeToc(id, nodes => moveTocNode(nodes, nodeId, parent, position))
}

/** Internal recovery copies for conflicts/imports; ordinary edits keep no history. */
export async function snapshotIn(id: string, nodes: TocNode[], source: 'conflict' | 'discarded', meta?: KnowledgeBaseMeta) {
  await db.knowledgeBaseTocHistory.add({ id: crypto.randomUUID(), book_id: id, time: Date.now(), nodes, source, ...(meta ? { meta } : {}) })
}

export async function applyKnowledgeBaseRemote(remote: KnowledgeBaseRemote, reconcile = false) {
  await db.transaction('rw', [...knowledgeBaseTables(), db.notes, db.bodies, db.outbox, db.history, db.meta], async () => {
    const id = remote.book.id
    const local = await db.knowledgeBases.get(id)
    if (remote.book.deleted) {
      const ids = remote.deleted_note_ids ?? []
      for (const noteId of ids) {
        const local = await db.notes.get(noteId)
        const localBody = (await db.bodies.get(noteId))?.body
        const pending = await db.outbox.where('note_id').equals(noteId).toArray()
        if (local && localBody?.trim() && pending.some(task => task.kind === 'body' || task.kind === 'create')) await createConflictCopy(local, localBody)
      }
      await db.notes.bulkDelete(ids)
      await db.bodies.bulkDelete(ids)
      await db.history.where('note_id').anyOf(ids).delete()
      await db.outbox.where('note_id').anyOf(ids).delete()
      await db.knowledgeBaseNoteStates.bulkPut(ids.map(id => ({ id, state: 'purged' as const })))
      await db.knowledgeBaseOutbox.where('book_id').equals(id).delete()
      await db.knowledgeBaseTocHistory.where('book_id').equals(id).delete()
      await db.knowledgeBases.put(remote.book)
      await db.knowledgeBaseTocs.put(remote.toc)
      return
    }
    // A delayed successful response must never bring a permanent tombstone back.
    if (local?.deleted) return
    const metaTask = await db.knowledgeBaseOutbox.get(taskId(id, 'meta'))
    const tocTask = await db.knowledgeBaseOutbox.get(taskId(id, 'toc'))
    const toc = await db.knowledgeBaseTocs.get(id)
    if (reconcile && local && toc && (JSON.stringify(toc.nodes) !== JSON.stringify(remote.toc.nodes) || JSON.stringify(metadata(local)) !== JSON.stringify(metadata(remote.book)))) {
      const previous = await db.knowledgeBaseTocHistory.where('book_id').equals(id).toArray()
      if (!previous.some(row => row.source === 'conflict' && JSON.stringify(row.nodes) === JSON.stringify(toc.nodes) && JSON.stringify(row.meta) === JSON.stringify(metadata(local)))) await snapshotIn(id, toc.nodes, 'conflict', metadata(local))
    }
    // A pull never resolves or overwrites an unacknowledged local change.
    if (!metaTask && (reconcile || !local || remote.book.meta_version >= local.meta_version)) {
      await db.knowledgeBases.put({ ...remote.book, toc_version: tocTask ? local?.toc_version ?? 0 : remote.toc.version,
        // A remote removal cannot silently turn a pending local edit into an
        // intentional archived write. Keep it visible until the CAS conflict.
        invalid: tocTask && local?.invalid === 0 && remote.book.invalid === 1 ? 0 : remote.book.invalid,
      })
    }
    if (!tocTask && (reconcile || !toc || remote.toc.version >= toc.version)) {
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
  if (current.book.deleted) { await applyKnowledgeBaseRemote(current); emitRemoteApplied(); return }
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    const row = await db.knowledgeBaseOutbox.get(task.id)
    if (!row || row.sent?.operation_id !== task.sent?.operation_id) return
    const toc = await db.knowledgeBaseTocs.get(task.book_id)
    const book = await db.knowledgeBases.get(task.book_id)
    await snapshotIn(task.book_id, toc?.nodes ?? [], 'conflict', book ? metadata(book) : undefined)
    await snapshotIn(task.book_id, current.toc.nodes, 'conflict', metadata(current.book))
    await db.knowledgeBaseOutbox.put({ ...row, blocked: true, error: '另一台设备修改了笔记本，请选择要保留的内容', conflict: current })
  })
  emitRemoteApplied()
}

/** Sync first; never delete from a stale or partially uploaded directory. */
export async function deleteKnowledgeBase(id: string, name: string) {
  const book = await db.knowledgeBases.get(id)
  if (!book || name !== book.name) throw new Error('请输入完整的笔记本名称')
  if (!book.meta_version || await db.knowledgeBaseOutbox.where('book_id').equals(id).count()) {
    throw new Error('请先完成笔记本同步并处理冲突，再重试删除')
  }
  try {
    const result = await apiFetch<KnowledgeBaseRemote>(`/api/knowledge-bases/${id}/delete`, {
      method: 'POST', body: JSON.stringify({ name, base_meta_version: book.meta_version, base_toc_version: book.toc_version }),
    })
    await applyKnowledgeBaseRemote(result)
    emitRemoteApplied()
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) throw new Error('笔记本已在其他设备更新，请同步后重新确认删除')
    if (e instanceof ApiError && e.status === 404) throw new Error('服务端未找到删除接口或笔记本，请同步或升级服务端后重试')
    if (e instanceof ApiError && e.status >= 500) throw new Error('删除暂未完成，请重试')
    if (e instanceof TypeError) throw new Error('请连接网络后重试删除')
    if (e instanceof Error && e.name === 'AbortError') throw new Error('删除请求超时，请联网后重试')
    throw e
  }
}

export async function resolveKnowledgeBaseConflict(id: string, kind: 'meta' | 'toc', choice: 'local' | 'remote') {
  const conflict = (await db.knowledgeBaseOutbox.get(taskId(id, kind)))?.conflict
  if (conflict?.book.deleted) { await applyKnowledgeBaseRemote(conflict); emitRemoteApplied(); return }
  await db.transaction('rw', knowledgeBaseTables(), async () => {
    const row = await db.knowledgeBaseOutbox.get(taskId(id, kind))
    if (!row?.conflict) return
    const remote = row.conflict
    const book = await db.knowledgeBases.get(id)
    const toc = await db.knowledgeBaseTocs.get(id)
    if (!book || book.deleted || !toc) return
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
