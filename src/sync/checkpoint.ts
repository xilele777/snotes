import { acceptSyncEpoch, ApiError, apiFetch } from '../api/client'
import { getMeta } from '../db/repo'
import { db } from '../db/schema'

export const SYNC_CHECKPOINT_KEY = 'sync_checkpoint'

export async function completeRecoveryPreflight(): Promise<void> {
  const nextEpoch = await getMeta<string>('sync_next_epoch')
  if (!nextEpoch) return
  const current = await apiFetch<{ epoch: string }>('/api/sync/instance')
  if (current.epoch !== nextEpoch) throw new Error('服务器恢复期间实例发生变化，请重试同步')
  acceptSyncEpoch(nextEpoch)
  await db.meta.put({ key: 'sync_instance_epoch', value: nextEpoch })
}

/** Validate before push: a restored server must not receive stale writes first. */
export async function needsReconciliation(): Promise<boolean> {
  const since = await getMeta<number>('sync_cursor') ?? 0
  const checkpoint = await getMeta<string>(SYNC_CHECKPOINT_KEY) ?? null
  try {
    const instance = await apiFetch<{ epoch: string }>('/api/sync/instance')
    if (instance.epoch) {
      const previous = await getMeta<string>('sync_instance_epoch')
      if (previous && previous !== instance.epoch) {
        await db.meta.put({ key: 'sync_reconcile_libraries', value: true })
      }
      // Adopt only for reads until all required inventories have completed.
      await db.meta.put({ key: 'sync_next_epoch', value: instance.epoch })
      if (previous && previous !== instance.epoch) return true
      if (!previous && since) return true
      if (!since) acceptSyncEpoch(instance.epoch)
    }
    if (!since) return false
    const result = await apiFetch<{ valid: boolean }>('/api/sync/checkpoint', {
      method: 'POST', body: JSON.stringify({ since, checkpoint }),
    })
    return !result.valid
  } catch (error) {
    // Rolling upgrades may briefly serve the old API. Other failures must stop
    // this round rather than assuming that pending writes are safe to upload.
    if (error instanceof ApiError && error.status === 404) return false
    throw error
  }
}
