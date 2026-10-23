import { acceptSyncEpoch, ApiError, apiFetch } from '../api/client'
import { getMeta } from '../db/repo'
import { db } from '../db/schema'

export const SYNC_CHECKPOINT_KEY = 'sync_checkpoint'

/**
 * /api/sync/instance 的同轮复用。一轮同步里 needsReconciliation 与
 * completeRecoveryPreflight 都要读实例 epoch：每个周期都查两次纯属浪费
 * （空闲轮也要为同一个值多打一个往返）。这里用短 TTL 缓存合并成一个请求；
 * 期间服务端真的换了实例也不怕——所有变更请求都带 X-Snotes-Epoch 头，
 * 服务端不认识就直接 409 拒绝（worker/app.ts）。
 * TTL 必须短于轮询间隔（30s），保证每个周期仍强制刷新一次。
 */
const INSTANCE_CACHE_MS = 10_000
let instanceCache: { at: number; promise: Promise<{ epoch: string }> } | null = null

function fetchInstance(): Promise<{ epoch: string }> {
  if (!instanceCache || Date.now() - instanceCache.at > INSTANCE_CACHE_MS) {
    const promise = apiFetch<{ epoch: string }>('/api/sync/instance')
    instanceCache = { at: Date.now(), promise }
    // 失败的请求不作数：清掉缓存让下一次调用重试，而不是缓存一个拒绝态。
    promise.catch(() => { if (instanceCache?.promise === promise) instanceCache = null })
  }
  return instanceCache.promise
}

/** 测试用：隔离各用例之间的模块级缓存。 */
export function resetInstanceEpochCache(): void {
  instanceCache = null
}

export async function completeRecoveryPreflight(): Promise<void> {
  const nextEpoch = await getMeta<string>('sync_next_epoch')
  if (!nextEpoch) return
  const current = await fetchInstance()
  if (current.epoch !== nextEpoch) throw new Error('服务器恢复期间实例发生变化，请重试同步')
  acceptSyncEpoch(nextEpoch)
  await db.meta.put({ key: 'sync_instance_epoch', value: nextEpoch })
}

/** Validate before push: a restored server must not receive stale writes first. */
export async function needsReconciliation(): Promise<boolean> {
  const since = await getMeta<number>('sync_cursor') ?? 0
  const checkpoint = await getMeta<string>(SYNC_CHECKPOINT_KEY) ?? null
  try {
    const instance = await fetchInstance()
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
