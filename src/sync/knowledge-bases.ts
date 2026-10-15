import type { KnowledgeBase, KnowledgeBaseAck, KnowledgeBaseRemote } from '../../shared/knowledge-base'
import { validateToc } from '../../shared/knowledge-base'
import { ApiError, apiFetch } from '../api/client'
import { db } from '../db/schema'
import { acknowledgeKnowledgeBaseTask, applyKnowledgeBaseRemote, blockKnowledgeBaseConflict, taskId } from '../db/knowledge-base-repo'
import type { KnowledgeBaseTask } from '../db/knowledge-base-types'
import { emitRemoteApplied } from './signal'

export const KNOWLEDGE_BASE_CURSOR = 'knowledge_base_cursor'
export const KNOWLEDGE_BASE_RECONCILED = 'knowledge_base_reconciled_at'

/** Keep the exact submitted request durable until ack, including after a reload. */
async function prepareTask(id: string, preserveMissing = false, archivedVersion?: number): Promise<KnowledgeBaseTask | undefined> {
  return db.transaction('rw', db.knowledgeBaseOutbox, async () => {
    const row = await db.knowledgeBaseOutbox.get(id)
    if (!row || row.blocked || row.next_at > Date.now()) return
    if (!row.sent) {
      row.sent = { seq: row.seq, base_version: row.base_version, operation_id: row.operation_id, payload: row.payload,
        ...(row.preserve_missing_references || preserveMissing ? { preserve_missing_references: true } : {}),
        ...(archivedVersion !== undefined ? { archived_meta_version: archivedVersion } : {}),
      }
      await db.knowledgeBaseOutbox.put(row)
    }
    return row
  })
}

async function push(): Promise<void> {
  const tasks = (await db.knowledgeBaseOutbox.toArray()).sort((a, b) => Number(a.kind === 'toc') - Number(b.kind === 'toc'))
  for (const queued of tasks) {
    const book = await db.knowledgeBases.get(queued.book_id)
    if (!book) continue
    let preserveMissing = false
    if (queued.kind === 'toc') {
      if (!book.meta_version || await db.knowledgeBaseOutbox.get(taskId(book.id, 'meta'))) continue
      const creates = new Set((await db.outbox.toArray()).filter(t => t.kind === 'create').map(t => t.note_id))
      const nodes = validateToc(queued.sent?.payload ?? queued.payload)
      if (nodes.some(n => n.note_id && creates.has(n.note_id))) continue
      for (const node of nodes) if (node.note_id) {
        const note = await db.notes.get(node.note_id)
        const state = await db.knowledgeBaseNoteStates.get(node.note_id)
        if (note?.invalid === 1 || state?.state === 'purged') preserveMissing = true
      }
    }
    const task = await prepareTask(queued.id, preserveMissing, queued.kind === 'toc' && book.invalid ? book.meta_version : undefined)
    if (!task) continue
    const sent = task.sent!
    try {
      const create = task.kind === 'meta' && sent.base_version === 0
      const path = `/api/knowledge-bases${create ? '' : `/${book.id}${task.kind === 'toc' ? '/toc' : ''}`}`
      const body = task.kind === 'toc'
        ? { operation_id: sent.operation_id, base_toc_version: sent.base_version, nodes: sent.payload,
          preserve_missing_references: sent.preserve_missing_references, archived_meta_version: sent.archived_meta_version }
        : { ...sent.payload, id: book.id, operation_id: sent.operation_id, base_meta_version: sent.base_version }
      const result = await apiFetch<KnowledgeBaseAck>(path, { method: create ? 'POST' : task.kind === 'toc' ? 'PUT' : 'PATCH', body: JSON.stringify(body) })
      await acknowledgeKnowledgeBaseTask(task, result)
      emitRemoteApplied()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error
      const conflict = error instanceof ApiError && (error.status === 409 || error.status === 410) ? (error.data as { current?: KnowledgeBaseRemote })?.current : undefined
      if (conflict) { await blockKnowledgeBaseConflict(task, conflict); continue }
      await db.transaction('rw', db.knowledgeBaseOutbox, async () => {
        const current = await db.knowledgeBaseOutbox.get(task.id)
        if (!current || current.sent?.operation_id !== sent.operation_id) return
        const retry = current.retry + 1
        const message = error instanceof ApiError && error.status === 404
          ? '服务端尚未支持笔记本，请升级服务端后重试'
          : error instanceof ApiError && error.status === 422 ? '引用的笔记尚未在服务端创建，请先同步笔记' : error instanceof Error ? error.message : String(error)
        await db.knowledgeBaseOutbox.update(task.id, { retry, next_at: Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(retry, 8)), error: message })
      })
    }
  }
}

async function pull(): Promise<void> {
  const lastFull = (await db.meta.get(KNOWLEDGE_BASE_RECONCILED))?.value as number | undefined
  const full = !lastFull || Date.now() - lastFull > 24 * 60 * 60 * 1000
  let since = full ? 0 : (await db.meta.get(KNOWLEDGE_BASE_CURSOR))?.value as number ?? 0
  let after = since
  let until: number | undefined
  for (;;) {
    let page: { books: KnowledgeBase[]; until: number; next_after: number | null }
    try {
      page = await apiFetch('/api/knowledge-bases/sync/pull', { method: 'POST', body: JSON.stringify({ since, after, until }) })
    } catch (error) {
      // A server restored from backup may have a smaller clock. Reconcile anew.
      if (since && error instanceof ApiError && error.status === 400 && (error.data as { error?: string })?.error === 'invalid_cursor') {
        since = after = 0; until = undefined; continue
      }
      throw error
    }
    until ??= page.until
    for (const book of page.books) {
      const remote = await apiFetch<KnowledgeBaseRemote>(`/api/knowledge-bases/${book.id}/toc`)
      validateToc(remote.toc.nodes)
      await applyKnowledgeBaseRemote(remote)
    }
    if (page.next_after === null) break
    after = page.next_after
  }
  // Only commit the independent cursor after every page and TOC has been saved.
  await db.meta.put({ key: KNOWLEDGE_BASE_CURSOR, value: until ?? since })
  if (full) await db.meta.put({ key: KNOWLEDGE_BASE_RECONCILED, value: Date.now() })
  emitRemoteApplied()
}

export async function syncKnowledgeBases(): Promise<{ error: string | null; failed: number }> {
  await push()
  let error: string | null = null
  try { await pull() } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e
    error = e instanceof ApiError && e.status === 404 ? '服务端尚未支持笔记本，请升级服务端' : e instanceof Error ? e.message : String(e)
  }
  const tasks = await db.knowledgeBaseOutbox.toArray()
  return { error: error ?? tasks.find(t => t.error)?.error ?? null, failed: tasks.filter(t => t.error || t.blocked).length }
}

export async function retryKnowledgeBases() {
  await db.transaction('rw', db.knowledgeBaseOutbox, async () => {
    const tasks = await db.knowledgeBaseOutbox.toArray()
    for (const task of tasks) if (!task.blocked) await db.knowledgeBaseOutbox.update(task.id, { next_at: 0, retry: 0 })
  })
}
