import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { setMeta } from '../db/repo'
import { ApiError, apiFetch } from '../api/client'
import { completeRecoveryPreflight, needsReconciliation, resetInstanceEpochCache, SYNC_CHECKPOINT_KEY } from './checkpoint'
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiFetch: vi.fn() }))
beforeEach(async () => {
  await db.delete()
  await db.open()
  vi.clearAllMocks()
  resetInstanceEpochCache()
})
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
it('reuses one instance fetch across both checks in the same round, but refetches after the cache expires', async () => {
  // 只冻结 Date：缓存 TTL 看 Date.now，而 IndexedDB 依赖真实定时器
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    await setMeta('sync_cursor', 100)
    // 已有同值 epoch：走完 checkpoint 校验而不是提前进入对账
    await setMeta('sync_instance_epoch', 'e1')
    vi.mocked(apiFetch).mockImplementation(async (path: unknown) =>
      path === '/api/sync/instance' ? { epoch: 'e1' } : { valid: true })
    await needsReconciliation()
    await completeRecoveryPreflight()
    // 两处检查共享同一次 GET /api/sync/instance，只补一个 checkpoint POST
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe('/api/sync/instance')

    vi.setSystemTime(Date.now() + 11_000)
    await needsReconciliation()
    // TTL 过期后重新强制刷新实例 epoch
    expect(vi.mocked(apiFetch).mock.calls[2][0]).toBe('/api/sync/instance')
  } finally {
    vi.useRealTimers()
  }
})
