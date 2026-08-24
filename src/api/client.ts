import { clearToken, getToken } from './token'
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

  const res = await fetch(path, { ...init, headers })

  if (res.status === 401) {
    clearToken()
    throw new ApiError(401, 'unauthorized')
  }

  if (!res.ok) {
    throw new ApiError(res.status, `request failed: ${res.status}`)
  }

  return res
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
