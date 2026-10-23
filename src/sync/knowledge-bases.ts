import type { KnowledgeBase, KnowledgeBaseAck, KnowledgeBaseRemote } from '../../shared/knowledge-base'
import { validateToc } from '../../shared/knowledge-base'
import { ApiError, apiFetch } from '../api/client'
import { db } from '../db/schema'
import { acknowledgeKnowledgeBaseTask, applyKnowledgeBaseRemote, blockKnowledgeBaseConflict, createKnowledgeBase, knowledgeBaseTables, metadata, snapshotIn, taskId } from '../db/knowledge-base-repo'
import type { KnowledgeBaseTask } from '../db/knowledge-base-types'
import { emitRemoteApplied } from './signal'

export const KNOWLEDGE_BASE_CURSOR = 'knowledge_base_cursor'
export const KNOWLEDGE_BASE_RECONCILED = 'knowledge_base_reconciled_at'
export const KNOWLEDGE_BASE_CHECKPOINT = 'knowledge_base_checkpoint'

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
      if (error instanceof ApiError && error.status === 409 && (error.data as { error?: string })?.error === 'sync_reset_required') throw error
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

async function pull(reconcile = false): Promise<void> {
  const lastFull = (await db.meta.get(KNOWLEDGE_BASE_RECONCILED))?.value as number | undefined
  const full = reconcile || !lastFull || Date.now() - lastFull > 24 * 60 * 60 * 1000
  let since = full ? 0 : (await db.meta.get(KNOWLEDGE_BASE_CURSOR))?.value as number ?? 0
  let after = since
  let until: number | undefined
  let changed = false
  const originals = full ? await db.knowledgeBases.toArray() : []
  const seen = new Set<string>()
  const checkpoint = (await db.meta.get(KNOWLEDGE_BASE_CHECKPOINT))?.value ?? null
  let receipt: string | undefined
  let afterId: string | undefined
  for (;;) {
    let page: { books: KnowledgeBase[]; until: number; next_after: number | null; next_id?: string | null; checkpoint?: string }
    try {
      page = await apiFetch('/api/knowledge-bases/sync/pull', { method: 'POST', body: JSON.stringify({ since, after, until, checkpoint, inventory: full, after_id: afterId }) })
    } catch (error) {
      // A server restored from backup may have a smaller clock. Reconcile anew.
      if (since && error instanceof ApiError && [400, 409].includes(error.status) && ['invalid_cursor', 'sync_reset_required'].includes((error.data as { error?: string })?.error ?? '')) {
        return pull(true)
      }
      throw error
    }
    if (until === undefined) { until = page.until; receipt = page.checkpoint }
    for (const book of page.books) {
      seen.add(book.id)
      const remote = await apiFetch<KnowledgeBaseRemote>(`/api/knowledge-bases/${book.id}/toc`)
      validateToc(remote.toc.nodes)
      if (reconcile) {
        const pending = await db.knowledgeBaseOutbox.where('book_id').equals(book.id).toArray()
        for (const task of pending) await blockKnowledgeBaseConflict(task, remote)
      }
      await applyKnowledgeBaseRemote(remote, reconcile)
      changed = true
    }
    if (page.next_id === null || page.next_id === undefined && page.next_after === null) break
    afterId = page.next_id ?? undefined
    after = page.next_after ?? after
  }
  // A complete inventory must still describe the same instance and revision.
  // Legacy servers have no receipt, so never infer missing rows from them.
  if (full && receipt) {
    const current = await apiFetch<{ valid: boolean }>('/api/knowledge-bases/sync/checkpoint', {
      method: 'POST', body: JSON.stringify({ since: until, checkpoint: receipt, require_current: true }),
    })
    if (!current.valid) throw new Error('笔记本对账期间远端发生变化，请重试同步')
  }
  await db.transaction('rw', [...knowledgeBaseTables(), db.meta], async () => {
    if (full && receipt) for (const original of originals) {
      if (seen.has(original.id) || original.deleted || !original.meta_version) continue
      const local = await db.knowledgeBases.get(original.id)
      if (!local || local.deleted) continue
      const toc = await db.knowledgeBaseTocs.get(local.id)
      await snapshotIn(local.id, toc?.nodes ?? [], 'conflict', metadata(local))
      // Absence is ambiguous after restore. Preserve a separate, syncable
      // recovery library rather than silently resurrecting the old identity.
      await db.knowledgeBases.update(local.id, { deleted: 1, invalid: 1 })
      await db.knowledgeBaseOutbox.where('book_id').equals(local.id).delete()
      await createKnowledgeBase({ ...metadata(local), name: `${local.name.slice(0, 90)}（恢复副本）` }, crypto.randomUUID(), toc?.nodes ?? [], true)
      changed = true
    }
    await db.meta.put({ key: KNOWLEDGE_BASE_CURSOR, value: until ?? since })
    if (receipt) await db.meta.put({ key: KNOWLEDGE_BASE_CHECKPOINT, value: receipt })
    if (full) await db.meta.put({ key: KNOWLEDGE_BASE_RECONCILED, value: Date.now() })
  })
  if (changed) emitRemoteApplied()
}

export async function prepareKnowledgeBaseSync(): Promise<void> {
  const since = (await db.meta.get(KNOWLEDGE_BASE_CURSOR))?.value as number | undefined
  if (since !== undefined && !(await db.meta.get('sync_reconcile_libraries'))?.value) {
    try {
      const result = await apiFetch<{ valid: boolean }>('/api/knowledge-bases/sync/checkpoint', {
        method: 'POST', body: JSON.stringify({ since, checkpoint: (await db.meta.get(KNOWLEDGE_BASE_CHECKPOINT))?.value ?? null }),
      })
      if (result.valid === false) await db.meta.put({ key: 'sync_reconcile_libraries', value: true })
    } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error }
  }
  if ((await db.meta.get('sync_reconcile_libraries'))?.value) {
    // Reconcile before replaying requests against a restored server. Keep the
    // marker on failure so reloading cannot accidentally resume stale uploads.
    await pull(true)
    await db.meta.delete('sync_reconcile_libraries')
  }
}

/**
 * prepared：调用方（同步引擎）本轮已经跑过 prepareKnowledgeBaseSync 时传 true，
 * 跳过重复的 checkpoint 校验请求。同一轮里校验两次没有意义——期间真有异常，
 * 笔记本写入自身还有 base 版本 CAS 与 epoch 头兜底，下一轮 prepare 也能对账。
 */
export async function syncKnowledgeBases(prepared = false): Promise<{ error: string | null; failed: number }> {
  if (!prepared) await prepareKnowledgeBaseSync()
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
