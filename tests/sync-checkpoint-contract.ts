import { expect, it } from 'vitest'
import type { PullResponse } from '../shared/types'
import type { Env } from '../worker/types'
import { CHECKPOINT_TTL_MS } from '../worker/sync-checkpoint'

export function syncCheckpointContract(api: (path: string, body: unknown) => Response | Promise<Response>, environment: () => Env) {
  const pull = async (body: unknown): Promise<PullResponse> => (await api('/api/sync/pull', body)).json()
  it('reuses idle receipts, validates the exact watermark and rejects receipts missing after backup restore', async () => {
    const first = await pull({ since: 0, checkpoint: null })
    expect(first.checkpoint).toBeTypeOf('string')
    expect((await pull({ since: 0 })).checkpoint).toBe(first.checkpoint)
    const request = { since: first.server_time, checkpoint: first.checkpoint }
    expect(await (await api('/api/sync/checkpoint', request)).json()).toEqual({ valid: true })
    expect((await api('/api/sync/pull', request)).status).toBe(200)
    await environment().DB.prepare('UPDATE note_sync_clock SET watermark = watermark + 1 WHERE id = 1').run()
    expect(await (await api('/api/sync/checkpoint', { ...request, require_current: true })).json()).toEqual({ valid: false })
    expect(await (await api('/api/sync/checkpoint', request)).json()).toEqual({ valid: true })
    // Restoring an older database loses receipts issued after that backup.
    await environment().DB.prepare('DELETE FROM sync_checkpoint').run()
    expect(await (await api('/api/sync/checkpoint', request)).json()).toEqual({ valid: false })
    expect((await api('/api/sync/pull', request)).status).toBe(409)
    expect((await api('/api/sync/pull', { since: 0, checkpoint: null })).status).toBe(200)
  })
  it('expires receipts before tombstones and rejects a checkpoint ahead of a rolled-back clock', async () => {
    const first = await pull({ since: 0 })
    const request = { since: first.server_time, checkpoint: first.checkpoint }
    const receipt = await environment().DB.prepare('SELECT expires_at FROM sync_checkpoint WHERE token = ?').bind(first.checkpoint).first<{ expires_at: number }>()
    expect(receipt!.expires_at - Date.now()).toBeLessThanOrEqual(CHECKPOINT_TTL_MS)
    await environment().DB.prepare('UPDATE sync_checkpoint SET expires_at = 1').run()
    expect((await api('/api/sync/pull', request)).status).toBe(409)
    const refreshed = await pull({ since: 0 })
    await environment().DB.prepare('UPDATE note_sync_clock SET watermark = 1 WHERE id = 1').run()
    expect(await (await api('/api/sync/checkpoint', { since: refreshed.server_time, checkpoint: refreshed.checkpoint })).json()).toEqual({ valid: false })
  })
  it('keeps legacy clients compatible but validates malformed cursors', async () => {
    expect((await api('/api/sync/pull', { since: 1 })).status).toBe(200)
    expect((await api('/api/sync/pull', { since: -1 })).status).toBe(400)
    expect((await api('/api/sync/checkpoint', { since: 1.5 })).status).toBe(400)
  })
  it('detects same-watermark table replacement and notebook-only rollback independently', async () => {
    const db = environment().DB
    const first = await pull({ since: 0 })
    // A partial restore can replace bodies without touching the note clock.
    await db.prepare("INSERT INTO note (id, create_time, update_time) VALUES ('restore', 1, 1)").run()
    await db.prepare("INSERT INTO note_body (note_id, content) VALUES ('restore', 'before')").run()
    const receipt = await pull({ since: 0 })
    await db.prepare("UPDATE note_body SET content = 'after' WHERE note_id = 'restore'").run()
    expect(await (await api('/api/sync/checkpoint', { since: receipt.server_time, checkpoint: receipt.checkpoint })).json()).toEqual({ valid: false })
    const books = await (await api('/api/knowledge-bases/sync/pull', { since: 0, inventory: true })).json() as { until: number; checkpoint: string }
    const request = { since: books.until, checkpoint: books.checkpoint }
    expect(await (await api('/api/knowledge-bases/sync/checkpoint', request)).json()).toEqual({ valid: true })
    // Zero-sequence imported rows must be present in a full inventory too.
    await db.prepare("INSERT INTO knowledge_base (id, name, create_time, update_time, last_operation_id) VALUES ('restored-book', 'restored', 1, 1, 'restore')").run()
    expect(await (await api('/api/knowledge-bases/sync/checkpoint', request)).json()).toEqual({ valid: false })
    const inventory = await (await api('/api/knowledge-bases/sync/pull', { since: 0, inventory: true })).json() as { books: { id: string }[] }
    expect(inventory.books.map(b => b.id)).toContain('restored-book')
    // Receipts cannot be exchanged between sync domains.
    expect(await (await api('/api/knowledge-bases/sync/checkpoint', { since: first.server_time, checkpoint: first.checkpoint })).json()).toEqual({ valid: false })
  })
  it('a restored instance epoch invalidates both domains even when clocks and receipts survive', async () => {
    const notes = await pull({ since: 0 })
    const books = await (await api('/api/knowledge-bases/sync/pull', { since: 0 })).json() as { until: number; checkpoint: string }
    await environment().DB.prepare("UPDATE sync_instance SET epoch = 'restored-instance' WHERE id = 1").run()
    expect(await (await api('/api/sync/checkpoint', { since: notes.server_time, checkpoint: notes.checkpoint })).json()).toEqual({ valid: false })
    expect(await (await api('/api/knowledge-bases/sync/checkpoint', { since: books.until, checkpoint: books.checkpoint })).json()).toEqual({ valid: false })
  })
}
