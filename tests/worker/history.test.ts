import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { HISTORY_KEEP } from '../../shared/history-rules'
import type { NoteHistoryResponse } from '../../shared/types'
import { api, json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

async function seedNote(content = '# 第一版') {
  const req = noteReq({ content, title: '标题', summary: content })
  await json('/api/notes', 'POST', req)
  return req
}

function patchBody(id: string, content: string, baseVersion: number) {
  return json(`/api/notes/${id}`, 'PATCH', { content, title: content, summary: content, base_version: baseVersion })
}

async function history(id: string) {
  const res = await api(`/api/notes/${id}/history`)
  expect(res.status).toBe(200)
  return (await res.json<NoteHistoryResponse>()).history
}

describe('云端正文历史', () => {
  it('第一次改正文时把被替换的旧正文存为快照，时间取旧正文的 update_time', async () => {
    const req = await seedNote('# 第一版')
    const before = await env.DB.prepare('SELECT update_time FROM note WHERE id = ?').bind(req.id).first<{ update_time: number }>()
    await patchBody(req.id, '# 第二版', 1)

    const rows = await history(req.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ body: '# 第一版', time: before!.update_time })
  })

  it('紧接着的小改动不再重复留存；正文不变的幂等重放也不留', async () => {
    const req = await seedNote('# 第一版')
    await patchBody(req.id, '# 第二版', 1)
    await patchBody(req.id, '# 第二版 少许', 2)
    await patchBody(req.id, '# 第二版 少许', 3)

    expect(await history(req.id)).toHaveLength(1)
  })

  it('被替换的旧正文比上一条快照多出 100 个以上可见字符时立刻留存', async () => {
    const req = await seedNote('# 第一版')
    await patchBody(req.id, '# 第二版', 1)
    const big = '# 第二版' + '字'.repeat(150)
    await patchBody(req.id, big, 2)
    await patchBody(req.id, '# 第三版', 3)

    const rows = await history(req.id)
    expect(rows.map((r) => r.body)).toEqual([big, '# 第一版'])
  })

  it('每条笔记最多保留 HISTORY_KEEP 条，最旧的先被修剪', async () => {
    const req = await seedNote('v0')
    for (let i = 1; i <= HISTORY_KEEP + 5; i++) {
      await patchBody(req.id, `v${i} ` + 'x'.repeat(i * 120), i)
    }
    const rows = await history(req.id)
    expect(rows).toHaveLength(HISTORY_KEEP)
    expect(rows.at(-1)!.body.startsWith('v5 ')).toBe(true)
  })

  it('POST /history 无条件补一条快照，重复同一正文不再叠加，空正文忽略', async () => {
    const req = await seedNote('# 当前')
    const time = Date.now() - 1000
    let res = await json(`/api/notes/${req.id}/history`, 'POST', { body: '# 当前', time })
    expect(await res.json()).toEqual({ ok: true, recorded: true })
    res = await json(`/api/notes/${req.id}/history`, 'POST', { body: '# 当前' })
    expect(await res.json()).toEqual({ ok: true, recorded: false })
    res = await json(`/api/notes/${req.id}/history`, 'POST', { body: '   ' })
    expect(await res.json()).toEqual({ ok: true, recorded: false })
    res = await json(`/api/notes/${req.id}/history`, 'POST', { nope: 1 })
    expect(res.status).toBe(400)

    const rows = await history(req.id)
    expect(rows).toEqual([expect.objectContaining({ body: '# 当前', time })])
  })

  it('彻底删除时连带清理历史；墓碑与不存在的笔记回 404', async () => {
    const req = await seedNote('# 第一版')
    await patchBody(req.id, '# 第二版', 1)
    await api(`/api/notes/${req.id}/purge`, { method: 'POST' })

    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM note_history WHERE note_id = ?').bind(req.id).first<{ n: number }>()
    expect(left!.n).toBe(0)
    expect((await api(`/api/notes/${req.id}/history`)).status).toBe(404)
    expect((await api('/api/notes/nope/history')).status).toBe(404)
    expect((await json(`/api/notes/${req.id}/history`, 'POST', { body: 'x' })).status).toBe(404)
  })

  it('接口需要鉴权', async () => {
    const req = await seedNote()
    expect((await api(`/api/notes/${req.id}/history`, {}, null)).status).toBe(401)
  })
})

describe('pull 下发回收站保留天数', () => {
  it('未配置时为 null，配置了则为整数天数，非法值按未知（null）处理', async () => {
    const { createApp } = await import('../../worker/app')
    const app = createApp()
    const pull = (over: Record<string, unknown>) =>
      app.request('/api/sync/pull', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: 0 }),
      }, { ...env, ...over })

    expect((await (await pull({ TRASH_RETENTION_DAYS: undefined })).json<{ trash_retention_days: unknown }>()).trash_retention_days).toBeNull()
    expect((await (await pull({ TRASH_RETENTION_DAYS: '30' })).json<{ trash_retention_days: unknown }>()).trash_retention_days).toBe(30)
    expect((await (await pull({ TRASH_RETENTION_DAYS: 'abc' })).json<{ trash_retention_days: unknown }>()).trash_retention_days).toBeNull()
  })
})
