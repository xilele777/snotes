import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'
import { clearToken, getToken, hasToken, setToken } from './token'

beforeEach(() => {
  localStorage.clear()
  clearToken()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(status: number, body: unknown = {}) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('token', () => {
  it('存取与清除', () => {
    expect(getToken()).toBeNull()

    setToken('abc')
    expect(getToken()).toBe('abc')
    expect(hasToken.value).toBe(true)

    clearToken()
    expect(getToken()).toBeNull()
    expect(hasToken.value).toBe(false)
  })

  it('令牌持久化到 localStorage', () => {
    setToken('abc')
    expect(localStorage.getItem('snotes_token')).toBe('abc')
  })

  it('同时写一份 Cookie 供 <img> 使用，作用域限定在图片路径', () => {
    // jsdom 默认页路径是 /，Cookie 带 Path=/api/images/ 时 document.cookie 读不回
    // ——那恰恰是「作用域被限定」该有的行为。所以这里 spy 在 setter 上，
    // 直接断言写出去的字符串，而不是去读 document.cookie。
    const spy = vi.spyOn(document, 'cookie', 'set')

    setToken('abc')

    expect(spy).toHaveBeenCalled()
    const header = spy.mock.calls[0][0]
    // Path 限定后 Cookie 只会随 /api/images/ 的请求发出，其余 API 仍然只认 Authorization 头
    expect(header).toContain('snotes_token=abc')
    expect(header).toContain('Path=/api/images/')
    expect(header).toContain('SameSite=Strict')
  })

  it('clearToken 同时抹掉 Cookie', () => {
    const spy = vi.spyOn(document, 'cookie', 'set')

    setToken('abc')
    clearToken()

    const clearHeader = spy.mock.calls.at(-1)![0]
    expect(clearHeader).toContain('Max-Age=0')
    expect(clearHeader).toContain('Path=/api/images/')
  })
})

describe('apiFetch', () => {
  it('自动附带 Bearer 头', async () => {
    setToken('tok')
    const fn = mockFetch(200, { ok: true })

    await apiFetch('/api/health')

    const init = fn.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
  })

  it('JSON body 自动设置 Content-Type', async () => {
    setToken('tok')
    const fn = mockFetch(200)

    await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify({ a: 1 }) })

    const init = fn.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('返回解析后的 JSON', async () => {
    setToken('tok')
    mockFetch(200, { version: 3 })

    expect(await apiFetch<{ version: number }>('/api/x')).toEqual({ version: 3 })
  })

  it('401 时清空本地令牌并抛出 ApiError', async () => {
    setToken('bad')
    mockFetch(401, { error: 'unauthorized' })

    await expect(apiFetch('/api/x')).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBeNull()
    expect(hasToken.value).toBe(false)
  })

  it('非 2xx 抛出带状态码的 ApiError', async () => {
    setToken('tok')
    mockFetch(500)

    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 500 })
  })

  it('令牌绝不出现在 URL 中', async () => {
    setToken('secret-token')
    const fn = mockFetch(200)

    await apiFetch('/api/health')

    expect(String(fn.mock.calls[0][0])).not.toContain('secret-token')
  })
})
