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
