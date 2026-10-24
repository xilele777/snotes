import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../worker/app'
import { IMAGE_COOKIE, timingSafeEqual } from '../../worker/auth'

const app = createApp()
const PROBE = '/api/__probe__'
const OK = { Authorization: 'Bearer test-token' }

describe('timingSafeEqual', () => {
  it('相同字符串返回 true', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
  })

  it('不同内容返回 false', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
  })

  it('不同长度返回 false 且不抛异常', () => {
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false)
    expect(timingSafeEqual('', 'a')).toBe(false)
  })
})

describe('auth 中间件', () => {
  it('health 免鉴权', async () => {
    const res = await app.request('/api/health', {}, env)
    expect(res.status).toBe(200)
  })

  it('缺少 Authorization 头返回 401', async () => {
    const res = await app.request(PROBE, {}, env)
    expect(res.status).toBe(401)
  })

  it('token 错误返回 401', async () => {
    const res = await app.request(PROBE, { headers: { Authorization: 'Bearer wrong' } }, env)
    expect(res.status).toBe(401)
  })

  it('非 Bearer 形式返回 401', async () => {
    const res = await app.request(PROBE, { headers: { Authorization: 'test-token' } }, env)
    expect(res.status).toBe(401)
  })

  it('token 正确则放行——404 说明已进入路由层', async () => {
    const res = await app.request(PROBE, { headers: OK }, env)
    expect(res.status).toBe(404)
  })
})

describe('全局请求体上限', () => {
  // owner 路由统一 12MB（与 server 版对齐）：超大 JSON 在进入路由处理前被拒，
  // 不会先整包解析进内存再被 zod/noteFits 拒绝。
  it('超过 12MB 的请求体回 413 payload_too_large', async () => {
    const res = await app.request('/api/sync/pull', {
      method: 'POST',
      headers: { ...OK, 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: 0, pad: 'x'.repeat(12 * 1024 * 1024) }),
    }, env)
    expect(res.status).toBe(413)
    expect(await res.json<{ error?: string }>()).toMatchObject({ error: 'payload_too_large' })
  })

  it('未认证的超大请求体仍先回 401（鉴权在前，不解析请求体）', async () => {
    const res = await app.request('/api/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(12 * 1024 * 1024 + 1024),
    }, env)
    expect(res.status).toBe(401)
  })
})

describe('图片专用 Cookie 分支', () => {
  const cookie = (v: string) => ({ Cookie: `${IMAGE_COOKIE}=${v}` })

  it('GET /api/images/* 接受同源 Cookie（放行后因对象不存在得到 404 而非 401）', async () => {
    const res = await app.request('/api/images/nope.png', { headers: cookie('test-token') }, env)
    expect(res.status).not.toBe(401)
  })

  it('Cookie 值错误仍返回 401', async () => {
    const res = await app.request('/api/images/nope.png', { headers: cookie('wrong') }, env)
    expect(res.status).toBe(401)
  })

  it('多个 Cookie 时能取出正确的那个', async () => {
    const res = await app.request(
      '/api/images/nope.png',
      { headers: { Cookie: `other=x; ${IMAGE_COOKIE}=test-token; z=1` } },
      env
    )
    expect(res.status).not.toBe(401)
  })

  it('Cookie 对上传（POST）无效——写操作只认 Bearer', async () => {
    const res = await app.request(
      '/api/images/upload',
      { method: 'POST', headers: cookie('test-token') },
      env
    )
    expect(res.status).toBe(401)
  })

  it('Cookie 对非图片路径无效', async () => {
    const res = await app.request(PROBE, { headers: cookie('test-token') }, env)
    expect(res.status).toBe(401)
  })
})
