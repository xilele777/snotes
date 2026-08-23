// shared/backoff.ts —— 退避调度（规格 §8.4）
// 零依赖、零 IO 的纯函数，前后端共用。

export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_MAX_MS = 600_000

export function backoffDelay(retry: number): number {
  const n = Math.max(0, retry)
  return Math.min(BACKOFF_BASE_MS * 2 ** n, BACKOFF_MAX_MS)
}

export function isRetriableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true
  return status >= 500
}
