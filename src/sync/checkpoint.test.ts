import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { setMeta } from '../db/repo'
import { ApiError, apiFetch } from '../api/client'
import { needsReconciliation, SYNC_CHECKPOINT_KEY } from './checkpoint'
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiFetch: vi.fn() }))
beforeEach(async () => { await db.delete(); await db.open(); vi.clearAllMocks() })
it('checks the persisted receipt before allowing an incremental sync', async () => {
  await setMeta('sync_cursor', 100)
  await setMeta(SYNC_CHECKPOINT_KEY, 'receipt')
  vi.mocked(apiFetch).mockResolvedValue({ valid: true })
  expect(await needsReconciliation()).toBe(false)
  expect(JSON.parse(vi.mocked(apiFetch).mock.calls[1][1]!.body as string)).toEqual({ since: 100, checkpoint: 'receipt' })
  vi.mocked(apiFetch).mockResolvedValue({ valid: false })
  expect(await needsReconciliation()).toBe(true)
})
it('network failure stops sync; only an old server without the endpoint falls back', async () => {
  await setMeta('sync_cursor', 100)
  vi.mocked(apiFetch).mockRejectedValue(new Error('offline'))
  await expect(needsReconciliation()).rejects.toThrow('offline')
  vi.mocked(apiFetch).mockRejectedValue(new ApiError(404, 'not found'))
  expect(await needsReconciliation()).toBe(false)
})
it('detects a deployment epoch change at the same cursor and durably gates notebook uploads', async () => {
  await setMeta('sync_cursor', 100)
  await setMeta('sync_instance_epoch', 'before')
  vi.mocked(apiFetch).mockResolvedValue({ epoch: 'after' })
  expect(await needsReconciliation()).toBe(true)
  expect((await db.meta.get('sync_reconcile_libraries'))?.value).toBe(true)
  expect((await db.meta.get('sync_instance_epoch'))?.value).toBe('before')
})
