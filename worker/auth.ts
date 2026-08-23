import type { MiddlewareHandler } from 'hono'
import type { Env } from './types'

export const IMAGE_COOKIE = 'snotes_token'

const BEARER = 'Bearer '
const IMAGE_PREFIX = '/api/images/'

/**
 * JS 层面做不到严格意义的常量时间比较（引擎的字符串内部表示与优化不受控），
 * 但避开「长度不同立刻返回」「首个不同字符立刻返回」这两个最容易被利用的早退点，
 * 对单用户自用场景的威胁模型已经足够。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null

  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() !== name) continue

    try {
      return decodeURIComponent(part.slice(idx + 1).trim())
    } catch {
      return null
    }
  }

  return null
}

export const auth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = c.env.ACCESS_TOKEN
  if (!expected) return c.json({ error: 'unauthorized' }, 401)

  const header = c.req.header('Authorization') ?? ''
  if (header.startsWith(BEARER) && timingSafeEqual(header.slice(BEARER.length), expected)) {
    return next()
  }

  // 唯一例外：浏览器的 <img src> 带不上自定义请求头，GET 图片额外接受同源 Cookie。
  // 严格限定 GET + /api/images/ 前缀，上传与其余端点一律只认 Bearer。
  if (c.req.method === 'GET' && new URL(c.req.url).pathname.startsWith(IMAGE_PREFIX)) {
    const cookie = readCookie(c.req.header('Cookie'), IMAGE_COOKIE)
    if (cookie && timingSafeEqual(cookie, expected)) return next()
  }

  return c.json({ error: 'unauthorized' }, 401)
}
