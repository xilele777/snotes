import { useUiStore } from '../stores/ui'
import { saveConflictCopies } from './conflict'
import { pullOnce } from './pull'
import { pushOnce } from './push'
import { onLocalWrite } from './signal'

export const POLL_INTERVAL_MS = 30_000
export const LOCAL_WRITE_DEBOUNCE_MS = 800

let inFlight: Promise<void> | null = null

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

      await pullOnce()
      ui.lastSyncError = null
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
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }

  const onOnline = () => void syncNow()

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
      void syncNow()
    }, LOCAL_WRITE_DEBOUNCE_MS)
  })

  // 页面不可见时不轮询，避免在后台白白消耗额度
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, POLL_INTERVAL_MS)

  void syncNow()

  return () => {
    clearInterval(timer)
    if (writeTimer !== undefined) clearTimeout(writeTimer)
    offLocalWrite()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}
