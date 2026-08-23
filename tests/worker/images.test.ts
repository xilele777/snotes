import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { IMAGE_COOKIE } from '../../worker/auth'
import { TOKEN, api, json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

function form(file: Blob, noteId: string, filename = 'a.png') {
  const fd = new FormData()
  fd.append('file', file, filename)
  fd.append('note_id', noteId)
  return fd
}

async function seedNote() {
  const req = noteReq()
  await json('/api/notes', 'POST', req)
  return req.id
}

describe('POST /api/images/upload', () => {
  it('上传成功后返回 file_key 与同源 url', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

    const res = await api('/api/images/upload', { method: 'POST', body: form(file, noteId) })

    expect(res.status).toBe(200)
    const body = await res.json<{ file_key: string; url: string; size: number; mime: string }>()
    expect(body.mime).toBe('image/png')
    expect(body.size).toBe(3)
    expect(body.url).toBe(`/api/images/${body.file_key}`)
    expect(body.file_key.startsWith(`${noteId}/`)).toBe(true)
  })

  it('对象写入 R2 且记录进 image 表', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([9])], { type: 'image/jpeg' })

    const res = await api('/api/images/upload', { method: 'POST', body: form(file, noteId, 'a.jpg') })
    const { file_key } = await res.json<{ file_key: string }>()

    expect(await env.R2.get(file_key)).not.toBeNull()
    const row = await env.DB.prepare('SELECT * FROM image WHERE file_key = ?').bind(file_key).first()
    expect(row).toMatchObject({ note_id: noteId, mime: 'image/jpeg', size: 1 })
  })

  it('文件扩展名由 MIME 决定', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([1])], { type: 'image/webp' })

    const res = await api('/api/images/upload', { method: 'POST', body: form(file, noteId, 'x.txt') })
    const { file_key } = await res.json<{ file_key: string }>()

    expect(file_key.endsWith('.webp')).toBe(true)
  })

  it('拒绝白名单之外的 MIME', async () => {
    const noteId = await seedNote()
    const file = new Blob(['<svg/>'], { type: 'image/svg+xml' })

    const res = await api('/api/images/upload', { method: 'POST', body: form(file, noteId, 'a.svg') })

    expect(res.status).toBe(415)
  })

  it('拒绝超过 10 MB 的文件', async () => {
    const noteId = await seedNote()
    const big = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' })

    const res = await api('/api/images/upload', { method: 'POST', body: form(big, noteId) })

    expect(res.status).toBe(413)
  })

  it('缺少 note_id 返回 400', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array([1])], { type: 'image/png' }), 'a.png')

    const res = await api('/api/images/upload', { method: 'POST', body: fd })

    expect(res.status).toBe(400)
  })

  it('note_id 不是 UUID 形状返回 400——它会拼进 R2 对象键', async () => {
    const file = new Blob([new Uint8Array([1])], { type: 'image/png' })

    const res = await api('/api/images/upload', {
      method: 'POST',
      body: form(file, '../../evil'),
    })

    expect(res.status).toBe(400)
  })

  it('缺少文件返回 400', async () => {
    const noteId = await seedNote()
    const fd = new FormData()
    fd.append('note_id', noteId)

    const res = await api('/api/images/upload', { method: 'POST', body: fd })

    expect(res.status).toBe(400)
  })

  it('未鉴权返回 401', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([1])], { type: 'image/png' })

    const res = await api(
      '/api/images/upload',
      { method: 'POST', body: form(file, noteId) },
      null
    )

    expect(res.status).toBe(401)
  })
})

describe('GET /api/images/:file_key', () => {
  it('返回图片二进制与不可变缓存头', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const upload = await api('/api/images/upload', { method: 'POST', body: form(file, noteId) })
    const { file_key } = await upload.json<{ file_key: string }>()

    const res = await api(`/api/images/${file_key}`)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('ETag')).toBeTruthy()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('key 含斜杠也能正确路由', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([7])], { type: 'image/png' })
    const upload = await api('/api/images/upload', { method: 'POST', body: form(file, noteId) })
    const { file_key } = await upload.json<{ file_key: string }>()

    expect(file_key).toContain('/')
    const res = await api(`/api/images/${file_key}`)
    expect(res.status).toBe(200)
  })

  it('不存在的 key 返回 404', async () => {
    const res = await api('/api/images/nope/x.png')
    expect(res.status).toBe(404)
  })

  it('If-None-Match 命中返回 304', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const upload = await api('/api/images/upload', { method: 'POST', body: form(file, noteId) })
    const { file_key } = await upload.json<{ file_key: string }>()

    const first = await api(`/api/images/${file_key}`)
    const etag = first.headers.get('ETag')!

    const second = await api(`/api/images/${file_key}`, { headers: { 'If-None-Match': etag } })

    expect(second.status).toBe(304)
  })

  // 这是整条链路上最容易漏掉的一环：浏览器的 <img src> 只会带 Cookie，不会带
  // Authorization。少了这个分支，列表缩略图与正文插图在真实浏览器里全是 401，
  // 而所有带 Bearer 的 Worker 测试都发现不了。
  it('只带 Cookie 不带 Bearer 也能读到图——<img src> 走的就是这条路', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const upload = await api('/api/images/upload', { method: 'POST', body: form(file, noteId) })
    const { file_key } = await upload.json<{ file_key: string }>()

    const res = await api(
      `/api/images/${file_key}`,
      { headers: { Cookie: `${IMAGE_COOKIE}=${TOKEN}` } },
      null
    )

    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('既无 Cookie 也无 Bearer 返回 401', async () => {
    const noteId = await seedNote()
    const file = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const upload = await api('/api/images/upload', { method: 'POST', body: form(file, noteId) })
    const { file_key } = await upload.json<{ file_key: string }>()

    const res = await api(`/api/images/${file_key}`, {}, null)
    expect(res.status).toBe(401)
  })
})
