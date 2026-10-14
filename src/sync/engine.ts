import { useUiStore } from '../stores/ui'
import { hasToken } from '../api/token'
import { saveConflictCopies } from './conflict'
import { pullOnce } from './pull'
import { pushOnce } from './push'
import { onLocalWrite } from './signal'
import { flushOpensSync, syncOpens } from './opens'
import { retryKnowledgeBases, syncKnowledgeBases } from './knowledge-bases'
import { db } from '../db/schema'

export const POLL_INTERVAL_MS = 30_000
export const LOCAL_WRITE_DEBOUNCE_MS = 800

let inFlight: Promise<void> | null = null
let retryInFlight: Promise<void> | null = null

/** Reconnecting invalidates network backoff, but never unblocks a structure conflict. */
export function retrySyncNow(): Promise<void> {
  if (retryInFlight) return retryInFlight
  retryInFlight = (async () => {
    // An old offline request must finish before resetting its retry delay.
    if (inFlight) await inFlight
    if (!hasToken.value) return
    await db.outbox.where('failed').equals(0).modify({ next_at: 0 })
    await retryKnowledgeBases()
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
      const result = await pushOnce()
      ui.failedCount = result.failedTotal

      if (result.conflicts.length > 0) {
        await saveConflictCopies(result.conflicts)
      }

      // Bug 1：push 途中若收到 401，client 已 clearToken + markTokenInvalid，
      // hasToken 此刻为 false，界面也在切回 TokenGate——别再发注定失败的 pull。
      if (!hasToken.value) return

      const pulled = await pullOnce()
      if (pulled.trashRetentionDays !== undefined) ui.trashRetentionDays = pulled.trashRetentionDays
      ui.lastSyncError = null
      if (hasToken.value) {
        const libraries = await syncKnowledgeBases()
        ui.knowledgeBaseSyncError = libraries.error
        ui.failedCount += libraries.failed
      }
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

  const onOnline = () => void retrySyncNow()

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
