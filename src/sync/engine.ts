import { useUiStore } from '../stores/ui'
import { hasToken } from '../api/token'
import { saveConflictCopies } from './conflict'
import { pullOnce } from './pull'
import { pushOnce } from './push'
import { onLocalWrite } from './signal'
import { flushOpensSync, syncOpens } from './opens'
import { prepareKnowledgeBaseSync, retryKnowledgeBases, syncKnowledgeBases } from './knowledge-bases'
import { db } from '../db/schema'
import { completeRecoveryPreflight, needsReconciliation } from './checkpoint'

export const POLL_INTERVAL_MS = 30_000
export const LOCAL_WRITE_DEBOUNCE_MS = 800

let inFlight: Promise<void> | null = null
let retryInFlight: Promise<void> | null = null

/** 显式重试重新激活失败任务；网络恢复只解除临时退避。 */
export function retrySyncNow(includeFailed = true): Promise<void> {
  if (retryInFlight) return retryInFlight
  retryInFlight = (async () => {
    // An old offline request must finish before resetting its retry delay.
    if (inFlight) await inFlight
    if (!hasToken.value) return
    // 用户明确点击重试时，永久失败任务也必须重新进入发送队列。
    // 失败原因和 payload 仍保留在 outbox，便于失败面板展示和放弃操作。
    if (includeFailed) await db.outbox.toCollection().modify({ failed: 0, next_at: 0 })
    else await db.outbox.where('failed').equals(0).modify({ next_at: 0 })
    if (includeFailed) await retryKnowledgeBases()
    await syncNow()
  })().finally(() => { retryInFlight = null })
  return retryInFlight
}

export function syncNow(): Promise<void> {
  if (inFlight) return inFlight

  const ui = useUiStore()

  inFlight = (async () => {
    ui.syncing = true

    try {
      const synchronize = async () => {
        if (!hasToken.value) return
        if (await needsReconciliation()) {
          await db.meta.put({ key: 'sync_reconcile_libraries', value: true })
          await pullOnce(true)
          // The notebook clock is independent; force its next pull as well.
          await db.meta.delete('knowledge_base_reconciled_at')
          await db.meta.delete('knowledge_base_cursor')
        }
        await prepareKnowledgeBaseSync()
        await completeRecoveryPreflight()
        const result = await pushOnce()
        ui.failedCount = result.failedTotal

        if (result.conflicts.length > 0) {
          await saveConflictCopies(result.conflicts)
        }

        // 401 会清掉令牌，此时不再发送注定失败的 pull。
        if (!hasToken.value) return

        const pulled = await pullOnce()
        if (pulled.trashRetentionDays !== undefined) ui.trashRetentionDays = pulled.trashRetentionDays
        ui.lastSyncError = result.failed > 0 ? '部分本地改动尚未同步，将保留并重试。' : null
        if (hasToken.value) {
          const libraries = await syncKnowledgeBases()
          ui.knowledgeBaseSyncError = libraries.error
          ui.failedCount += libraries.failed
        }
      }
      // 同源标签页共用 IndexedDB/outbox；锁覆盖 push、冲突落库和 pull 整轮。
      // 不支持 Web Locks 的浏览器仍使用模块内 inFlight 和事务 seq 保护。
      if (navigator.locks?.request) await navigator.locks.request('snotes-sync', synchronize)
      else await synchronize()
    } catch (error) {
      ui.lastSyncError = error instanceof Error ? error.message : String(error)
    } finally {
      ui.syncing = false
      inFlight = null
    }
  })()

  return inFlight
}

export function startSyncEngine(): () => void {
  let active = true
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow()
    else void flushOpensSync().catch(() => undefined)
  }

  const onOnline = () => void retrySyncNow(false)

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)

  // 规格 8.3 的第五个触发点：本地写入后 debounce 800 ms 再推。
  // 不 debounce 的话，连续敲字每次落库都会打一个请求。
  // 走 syncNow 而不是直接 pushOnce，是因为冲突副本的处理只在 syncNow 里。
  let writeTimer: ReturnType<typeof setTimeout> | undefined
  const offLocalWrite = onLocalWrite(() => {
    if (writeTimer !== undefined) clearTimeout(writeTimer)
    writeTimer = setTimeout(() => {
      writeTimer = undefined
      // A write's debounce may expire during a slow request. Schedule it after
      // that request instead of coalescing it away until the next 30s poll.
      const pending = inFlight
      if (pending) void pending.then(() => { if (active && hasToken.value) void syncNow() })
      else void syncNow()
    }, LOCAL_WRITE_DEBOUNCE_MS)
  })

  // 页面不可见时不轮询，避免在后台白白消耗额度
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void syncNow()
      void syncOpens().catch(() => undefined)
    }
  }, POLL_INTERVAL_MS)

  void syncNow()
  void syncOpens().catch(() => undefined)

  return () => {
    active = false
    clearInterval(timer)
    if (writeTimer !== undefined) clearTimeout(writeTimer)
    offLocalWrite()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}
