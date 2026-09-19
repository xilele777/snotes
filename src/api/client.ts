import { clearToken, getToken, markTokenInvalid } from './token'
import type { MetricsData } from '../../shared/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)

  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetchWithTimeout(path, { ...init, headers })

  if (res.status === 401) {
    // Bug 1：令牌失效要有可见反馈——clearToken 后界面切回 TokenGate，
    // markTokenInvalid 让它说明「不是首次使用、是令牌过期了」。
    clearToken()
    markTokenInvalid()
    throw new ApiError(401, 'unauthorized')
  }

  if (!res.ok) {
    throw new ApiError(res.status, `request failed: ${res.status}`)
  }

  return res
}

/** Bug 4：请求最多等 15 秒。网络挂起时同步引擎的 inFlight 不再被永久占住。 */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * fetch 包一层超时。用 AbortController + setTimeout，而不是 AbortSignal.timeout：
 * 后者在测试里会留下无人清理的真实计时器；这里手动建、请求结束就清掉。
 * 超时以 AbortError 拒绝，交由调用方（push 的 catch、同步引擎）按网络错误处理，
 * 让该轮同步快速失败、inFlight 得以复位。
 */
async function fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(path, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await request(path, { ...init, headers })
  return res.json() as Promise<T>
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await request(path, { method: 'POST', body: form })
  return res.json() as Promise<T>
}

/** 取原始二进制响应（导出时把图片打进 zip）。同样走 Bearer 鉴权与 401 处理。 */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await request(path, { method: 'GET' })
  return res.blob()
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
