import { clearToken, getToken, markTokenInvalid, markTooManyAttempts } from './token'
import type { MetricsData } from '../../shared/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const REQUEST_TIMEOUT_MS = 15_000
let syncEpoch: string | null = null
export function acceptSyncEpoch(epoch: string): void { syncEpoch = epoch }

async function request<T>(path: string, init: RequestInit, decode: (response: Response) => Promise<T>): Promise<T> {
  const headers = new Headers(init.headers)
  if (syncEpoch) headers.set('X-Snotes-Epoch', syncEpoch)

  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const controller = new AbortController()
  let timeoutReject!: (error: unknown) => void
  const timeout = new Promise<never>((_, reject) => { timeoutReject = reject })
  // The promise is also retained after a fast response; mark its eventual
  // rejection handled so an aborted request cannot produce an unhandled error.
  void timeout.catch(() => undefined)
  const timer = setTimeout(() => {
    controller.abort()
    timeoutReject(new DOMException('Request timed out', 'TimeoutError'))
  }, REQUEST_TIMEOUT_MS)
  const caller = init.signal
  const abort = () => {
    controller.abort(caller?.reason)
    timeoutReject(caller?.reason ?? new DOMException('Aborted', 'AbortError'))
  }
  if (caller?.aborted) abort()
  else caller?.addEventListener('abort', abort, { once: true })
  try {
    const res = await Promise.race([fetch(path, { ...init, headers, signal: controller.signal }), timeout])

    if (res.status === 401) {
      // Bug 1：令牌失效要有可见反馈——clearToken 后界面切回 TokenGate，
      // markTokenInvalid 让它说明「不是首次使用、是令牌过期了」。
      clearToken()
      markTokenInvalid()
      throw new ApiError(401, 'unauthorized')
    }

    // 服务器版登录限流：连续输错令牌达到阈值后所有 API 都返回 429，同样回到令牌页，
    // 但提示改为「稍后再试」。其它来源的 429（如 Cloudflare 速率限制）不带这个 error 字段，照常按可重试错误处理。
    if (res.status === 429) {
      const body = await Promise.race([res.clone().json().catch(() => null), timeout]) as { error?: string; retry_after?: number } | null
      if (body?.error === 'too_many_attempts') {
        const retryAfter = Number(body.retry_after ?? res.headers.get('Retry-After') ?? 60)
        clearToken()
        markTooManyAttempts(Number.isFinite(retryAfter) ? retryAfter : 60)
        throw new ApiError(429, 'too_many_attempts')
      }
    }

    if (!res.ok) {
      const data = await Promise.race([res.json().catch(() => undefined), timeout])
      throw new ApiError(res.status, `request failed: ${res.status}`, data)
    }

    return await Promise.race([decode(res), timeout])
  } finally {
    clearTimeout(timer)
    caller?.removeEventListener('abort', abort)
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return request(path, { ...init, headers }, res => res.json() as Promise<T>)
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return request(path, { method: 'POST', body: form }, res => res.json() as Promise<T>)
}

/** 取原始二进制响应（导出时把图片打进 zip）。同样走 Bearer 鉴权与 401 处理。 */
export async function apiBlob(path: string): Promise<Blob> {
  return request(path, { method: 'GET' }, res => res.blob())
}

export interface MetricsResponse {
  ok: true
  data: MetricsData
}
export interface MetricsErrorResponse {
  error: string
  message?: string
}

/** 监控页（Bug 8）：拉 D1/R2/HTTP 指标。走同一套 Bearer 鉴权头。 */
export function apiMetrics(): Promise<MetricsResponse | MetricsErrorResponse> {
  return apiFetch('/api/metrics/types', { method: 'POST' })
}
