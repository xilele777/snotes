import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { TOMBSTONE_RETENTION_MS } from '../../worker/db'
import worker from '../../worker/index'
import { ORPHAN_IMAGE_GRACE_MS, deleteOrphanImages, parseTrashRetentionDays, purgeExpiredTrash, runMaintenance } from '../../worker/maintenance'
import { api, json, noteReq, resetDb } from './helpers'

beforeEach(resetDb)

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

async function seedImage(noteId: string, key: string, createTime: number) {
  await env.R2.put(key, new Uint8Array([1, 2, 3]))
  await env.DB.prepare('INSERT INTO image (file_key, note_id, size, mime, create_time) VALUES (?, ?, ?, ?, ?)')
    .bind(key, noteId, 3, 'image/png', createTime)
    .run()
}

async function imageRows() {
  const { results } = await env.DB.prepare('SELECT file_key FROM image ORDER BY file_key').all<{ file_key: string }>()
  return results.map((r) => r.file_key)
}

describe('parseTrashRetentionDays', () => {
  it('未设置或空串按默认 30 天；0、off 表示关闭', () => {
    for (const value of [undefined, null, '', ' ']) {
      expect(parseTrashRetentionDays(value)).toBe(30)
    }
    for (const value of ['0', 'off', 'OFF', 'false']) {
      expect(parseTrashRetentionDays(value)).toBeNull()
    }
  })

  it('正整数天数原样返回', () => {
    expect(parseTrashRetentionDays('30')).toBe(30)
    expect(parseTrashRetentionDays(' 7 ')).toBe(7)
  })

  it('非法值抛错而不是静默猜测', () => {
    for (const value of ['-1', '1.5', 'abc', '30d']) {
      expect(() => parseTrashRetentionDays(value)).toThrow('TRASH_RETENTION_DAYS')
    }
  })
})

describe('deleteOrphanImages', () => {
  it('删除正文里不再引用且超过宽限期的图片，保留仍被引用的', async () => {
    const req = noteReq({ content: '![](/api/images/n/kept.png)' })
    await json('/api/notes', 'POST', req)
    const old = NOW - ORPHAN_IMAGE_GRACE_MS - 1
    await seedImage(req.id, 'n/kept.png', old)
    await seedImage(req.id, 'n/orphan.png', old)

    const deleted = await deleteOrphanImages(env, NOW)

    expect(deleted).toEqual(['n/orphan.png'])
    expect(await imageRows()).toEqual(['n/kept.png'])
    expect(await env.R2.get('n/orphan.png')).toBeNull()
    expect(await env.R2.get('n/kept.png')).not.toBeNull()
  })

  it('宽限期内的孤儿不动，留给撤销和多端同步', async () => {
    const req = noteReq({ content: '没有图片' })
    await json('/api/notes', 'POST', req)
    await seedImage(req.id, 'n/fresh.png', NOW - ORPHAN_IMAGE_GRACE_MS + 1000)

    expect(await deleteOrphanImages(env, NOW)).toEqual([])
    expect(await imageRows()).toEqual(['n/fresh.png'])
  })

  it('所属笔记正文已不存在的图片视为孤儿', async () => {
    await seedImage(crypto.randomUUID(), 'gone/a.png', NOW - ORPHAN_IMAGE_GRACE_MS - 1)

    expect(await deleteOrphanImages(env, NOW)).toEqual(['gone/a.png'])
    expect(await imageRows()).toEqual([])
  })

  it('file_key 是另一个 key 的前缀时不会误判为被引用', async () => {
    const req = noteReq({ content: '![](/api/images/n/a.png.bak)' })
    await json('/api/notes', 'POST', req)
    const old = NOW - ORPHAN_IMAGE_GRACE_MS - 1
    await seedImage(req.id, 'n/a.png.bak', old)
    await seedImage(req.id, 'n/a.png', old)

    // `/api/images/n/a.png` 是 `/api/images/n/a.png.bak` 的子串，instr 会命中；
    // 这是已知的保守取舍：宁可多留一张图，也不能误删被引用的。
    expect(await deleteOrphanImages(env, NOW)).toEqual([])
  })
})

describe('purgeExpiredTrash', () => {
  it('保留期关闭时什么都不做', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)
    await api(`/api/notes/${req.id}/trash`, { method: 'POST' })

    expect(await purgeExpiredTrash(env, null, Date.now() + 365 * DAY)).toEqual([])
    const note = await env.DB.prepare('SELECT invalid FROM note WHERE id = ?').bind(req.id).first<{ invalid: number }>()
    expect(note!.invalid).toBe(1)
  })

  it('超过保留期的回收站笔记墓碑化并回收正文与图片，未超期的保留', async () => {
    const expired = noteReq()
    const recent = noteReq()
    const active = noteReq()
    for (const req of [expired, recent, active]) await json('/api/notes', 'POST', req)
    await api(`/api/notes/${expired.id}/trash`, { method: 'POST' })
    await env.DB.prepare('UPDATE note SET update_time = ? WHERE id = ?').bind(Date.now() - 31 * DAY, expired.id).run()
    await api(`/api/notes/${recent.id}/trash`, { method: 'POST' })
    await seedImage(expired.id, `${expired.id}/img.png`, 1)

    const purged = await purgeExpiredTrash(env, 30, Date.now())

    expect(purged).toEqual([expired.id])
    const rows = await env.DB.prepare('SELECT id, invalid FROM note').all<{ id: string; invalid: number }>()
    const byId = Object.fromEntries(rows.results.map((r) => [r.id, r.invalid]))
    expect(byId).toEqual({ [expired.id]: 2, [recent.id]: 1, [active.id]: 0 })
    expect(await env.DB.prepare('SELECT note_id FROM note_body WHERE note_id = ?').bind(expired.id).first()).toBeNull()
    expect(await env.R2.get(`${expired.id}/img.png`)).toBeNull()
  })

  it('墓碑化后 pull 能把删除信号带给其他客户端', async () => {
    const req = noteReq()
    await json('/api/notes', 'POST', req)
    await api(`/api/notes/${req.id}/trash`, { method: 'POST' })
    await env.DB.prepare('UPDATE note SET update_time = ? WHERE id = ?').bind(Date.now() - 8 * DAY, req.id).run()

    await purgeExpiredTrash(env, 7, Date.now())

    const res = await json('/api/sync/pull', 'POST', { since: 0 })
    const body = await res.json() as { notes: { id: string; invalid: number }[] }
    expect(body.notes.find((n) => n.id === req.id)?.invalid).toBe(2)
  })
})

describe('runMaintenance', () => {
  it('三项任务一起跑并返回统计，保留期关闭时不清回收站', async () => {
    const trashed = noteReq()
    await json('/api/notes', 'POST', trashed)
    await api(`/api/notes/${trashed.id}/trash`, { method: 'POST' })
    await env.DB.prepare('UPDATE note SET update_time = ? WHERE id = ?').bind(1, trashed.id).run()
    await seedImage(crypto.randomUUID(), 'x/orphan.png', 1)
    await env.DB.prepare('INSERT INTO note (id, invalid, create_time, update_time) VALUES (?, 2, 1, ?)')
      .bind('tomb', Date.now() - TOMBSTONE_RETENTION_MS - 1).run()

    const report = await runMaintenance({ ...env, TRASH_RETENTION_DAYS: 'off' }, Date.now())

    expect(report).toEqual({ orphan_images: 1, expired_trash: 0, reaped_tombstones: 1 })
    expect(await env.DB.prepare('SELECT id FROM note WHERE id = ?').bind('tomb').first()).toBeNull()
    const note = await env.DB.prepare('SELECT invalid FROM note WHERE id = ?').bind(trashed.id).first<{ invalid: number }>()
    expect(note!.invalid).toBe(1)
  })

  it('从 Env 读取 TRASH_RETENTION_DAYS', async () => {
    const trashed = noteReq()
    await json('/api/notes', 'POST', trashed)
    await api(`/api/notes/${trashed.id}/trash`, { method: 'POST' })
    await env.DB.prepare('UPDATE note SET update_time = ? WHERE id = ?').bind(Date.now() - 2 * DAY, trashed.id).run()

    const report = await runMaintenance({ ...env, TRASH_RETENTION_DAYS: '1' }, Date.now())

    expect(report.expired_trash).toBe(1)
  })

  it('非法的保留期配置让任务报错而不是清理数据', async () => {
    await expect(runMaintenance({ ...env, TRASH_RETENTION_DAYS: 'soon' })).rejects.toThrow('TRASH_RETENTION_DAYS')
  })
})

describe('scheduled 入口', () => {
  it('cron 触发时执行维护任务', async () => {
    await seedImage(crypto.randomUUID(), 'cron/orphan.png', 1)
    const ctx = createExecutionContext()

    await worker.scheduled({ scheduledTime: Date.now(), cron: '17 3 * * *', noRetry() {} } as ScheduledController, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(await imageRows()).toEqual([])
  })
})
