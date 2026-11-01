import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { HISTORY_KEEP, HISTORY_MAX_AGE_MS } from '../../shared/history-rules'
import { MAX_NOTE_BYTES } from '../../shared/limits'
import type { NoteHistoryResponse } from '../../shared/types'
import { createApp } from '../../worker/app'
import type { Database } from '../../worker/storage'
import { api, json, noteReq, resetDb, TOKEN } from './helpers'

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
  it('does not immediately expire a conflict snapshot of a long-unchanged note', async () => {
    const req = await seedNote('old remote body')
    await env.DB.prepare('UPDATE note SET update_time = ? WHERE id = ?').bind(Date.now() - HISTORY_MAX_AGE_MS - 1000, req.id).run()
    const response = await patchBody(req.id, 'offline local body', 0)
    expect(await response.json()).toMatchObject({ conflicted: true })
    expect((await history(req.id)).map(row => row.body)).toContain('old remote body')
  })

  it('commits conflict history with the body even when execution stops immediately after the batch', async () => {
    const req = await seedNote('initial')
    await patchBody(req.id, 'device a', 1)
    const interrupted: Database = {
      prepare: sql => env.DB.prepare(sql),
      async batch(statements) {
        await env.DB.batch(statements as D1PreparedStatement[])
        throw new Error('interrupted after commit')
      },
    }
    const response = await createApp().request(`/api/notes/${req.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'device b', title: 'device b', summary: 'device b', base_version: 1 }),
    }, { ...env, DB: interrupted })
    expect(response.status).toBe(500)
    expect((await history(req.id)).map(row => row.body)).toContain('device a')
    expect(await (await patchBody(req.id, 'device b', 1)).json()).toMatchObject({ version: 3, conflicted: false })
    expect((await history(req.id)).filter(row => row.body === 'device a')).toHaveLength(1)
  })

  it('conflict snapshots still respect the history retention count', async () => {
    const req = await seedNote('v0')
    for (let i = 1; i <= HISTORY_KEEP + 3; i++) await patchBody(req.id, `v${i}`, 0)
    const rows = await history(req.id)
    expect(rows).toHaveLength(HISTORY_KEEP)
    expect(rows.at(-1)?.body).toBe('v3')
  })

  it('retains a short conflicted body even if the response is lost and the write is replayed', async () => {
    const req = await seedNote('initial')
    await patchBody(req.id, 'device a', 1)
    // Simulate a successful conflicting write whose response the client loses.
    await patchBody(req.id, 'device b', 1)
    const retry = await patchBody(req.id, 'device b', 1)
    expect(await retry.json()).toMatchObject({ conflicted: false, version: 3 })
    expect((await history(req.id)).map(row => row.body)).toContain('device a')
  })

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

  it('POST /history 拒绝超过正文上限的快照；time 范围外的值回落到当前行的 update_time', async () => {
    const req = await seedNote('# 当前')
    const note = await env.DB.prepare('SELECT update_time FROM note WHERE id = ?').bind(req.id).first<{ update_time: number }>()

    const oversized = await json(`/api/notes/${req.id}/history`, 'POST', { body: 'x'.repeat(MAX_NOTE_BYTES + 1) })
    expect(oversized.status).toBe(413)

    let res = await json(`/api/notes/${req.id}/history`, 'POST', { body: '# 快照一', time: -5 })
    expect(await res.json()).toEqual({ ok: true, recorded: true })
    res = await json(`/api/notes/${req.id}/history`, 'POST', { body: '# 快照二', time: Date.now() + 10 * 60_000 })
    expect(await res.json()).toEqual({ ok: true, recorded: true })

    const rows = await history(req.id)
    expect(rows.map((r) => r.time)).toEqual([note!.update_time, note!.update_time])
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
  it('未配置时为默认 30，配置了则为整数天数，关闭为 null，非法值按未知（null）处理', async () => {
    const { createApp } = await import('../../worker/app')
    const app = createApp()
    const pull = (over: Record<string, unknown>) =>
      app.request('/api/sync/pull', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: 0 }),
      }, { ...env, ...over })

    expect((await (await pull({ TRASH_RETENTION_DAYS: undefined })).json<{ trash_retention_days: unknown }>()).trash_retention_days).toBe(30)
    expect((await (await pull({ TRASH_RETENTION_DAYS: 'off' })).json<{ trash_retention_days: unknown }>()).trash_retention_days).toBeNull()
    expect((await (await pull({ TRASH_RETENTION_DAYS: '30' })).json<{ trash_retention_days: unknown }>()).trash_retention_days).toBe(30)
    expect((await (await pull({ TRASH_RETENTION_DAYS: 'abc' })).json<{ trash_retention_days: unknown }>()).trash_retention_days).toBeNull()
  })
})
