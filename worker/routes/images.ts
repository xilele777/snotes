import { Hono } from 'hono'
import { nowMs } from '../db'
import type { Env } from '../types'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

const MAX_BYTES = 10 * 1024 * 1024
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

// note_id 会直接拼进 R2 的对象键，必须限死成 UUID 形状。
// 否则调用方能用 `../` 或任意前缀把图片写到别的命名空间下，
// 让 purgeNotes 按 note_id 回收孤儿图片的逻辑失效。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const imagesRoutes = new Hono<{ Bindings: Env }>()

imagesRoutes.post('/api/images/upload', async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ error: 'invalid_form' }, 400)

  const file = form.get('file')
  const noteId = form.get('note_id')

  if (!(file instanceof File) || typeof noteId !== 'string' || !UUID_RE.test(noteId)) {
    return c.json({ error: 'file_and_note_id_required' }, 400)
  }

  const ext = MIME_EXT[file.type]
  if (!ext) return c.json({ error: 'unsupported_media_type' }, 415)

  if (file.size > MAX_BYTES) return c.json({ error: 'payload_too_large' }, 413)

  const fileKey = `${noteId}/${crypto.randomUUID()}.${ext}`

  await c.env.R2.put(fileKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type, cacheControl: CACHE_CONTROL },
  })

  await c.env.DB.prepare(
    'INSERT INTO image (file_key, note_id, size, mime, create_time) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(fileKey, noteId, file.size, file.type, nowMs())
    .run()

  return c.json({
    file_key: fileKey,
    url: `/api/images/${fileKey}`,
    size: file.size,
    mime: file.type,
  })
})

imagesRoutes.get('/api/images/:file_key{.+}', async (c) => {
  const fileKey = c.req.param('file_key')

  // Cache API 在 Miniflare 测试环境里可能抛「This context has no ExecutionContext」，
  // 边缘缓存只是性能优化、不是正确性要求，因此整体用 try 包住，失败时直读 R2。
  try {
    const cache = caches.default
    const cacheKey = new Request(new URL(c.req.url).toString(), { method: 'GET' })

    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const object = await c.env.R2.get(fileKey)
    if (!object) return c.json({ error: 'not_found' }, 404)

    const etag = object.httpEtag

    if (c.req.header('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } })
    }

    const response = new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Cache-Control': CACHE_CONTROL,
        ETag: etag,
      },
    })

    c.executionCtx.waitUntil?.(cache.put(cacheKey, response.clone()))

    return response
  } catch {
    // 落到无缓存路径
  }

  const object = await c.env.R2.get(fileKey)
  if (!object) return c.json({ error: 'not_found' }, 404)

  const etag = object.httpEtag

  if (c.req.header('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': CACHE_CONTROL,
      ETag: etag,
    },
  })
})
