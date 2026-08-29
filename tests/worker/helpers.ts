import { env } from 'cloudflare:test'
import { createApp } from '../../worker/app'
import type { CreateNoteRequest } from '../../shared/types'

export const TOKEN = 'test-token'

const app = createApp()

export function api(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  // 只对字符串 body 补 JSON 头；FormData 必须让运行时自己补 multipart 边界
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return app.request(path, { ...init, headers }, env)
}

export function json(path: string, method: string, body: unknown, token: string | null = TOKEN) {
  return api(path, { method, body: JSON.stringify(body) }, token)
}

export async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM image'),
    env.DB.prepare('DELETE FROM note_body'),
    env.DB.prepare('DELETE FROM note'),
    env.DB.prepare('DELETE FROM note_group'),
    env.DB.prepare('DELETE FROM note_open'),
  ])
}

export function noteReq(over: Partial<CreateNoteRequest> = {}): CreateNoteRequest {
  return {
    id: crypto.randomUUID(),
    create_time: 1_700_000_000_000,
    content: '# 标题\n正文',
    title: '标题',
    summary: '标题 正文',
    ...over,
  }
}
