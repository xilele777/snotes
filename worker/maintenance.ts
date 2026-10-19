import { nowMs, purgeNotes, reapTombstones } from './db'
import { cleanupDeletedNotebookImages } from './knowledge-base-deletion'
import type { Env } from './types'
import { QUERY_BATCH_SIZE } from './query-limits'

/**
 * 定时维护任务。Worker 的 `scheduled` 处理器与服务器版的 setInterval 都调用这一份函数，
 * 与 `createApp` 一样由两端共用。
 *
 * 三件事按顺序执行：
 * 1. 保留图片清理入口，但暂缓已提交图片永久回收，保护离线及跨笔记引用。
 * 2. 清理过期回收站：`invalid = 1` 且进入回收站超过保留期的笔记走 purgeNotes 墓碑化。
 *    保留期是部署级配置（TRASH_RETENTION_DAYS），默认 30 天，设为 0 / off 关闭。
 * 3. 回收超过保留期的墓碑行，不再依赖用户手动「清空回收站」。
 */

/** 兼容旧调用与测试的历史宽限期；当前图片永久回收已暂停。 */
export const ORPHAN_IMAGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

const BATCH = QUERY_BATCH_SIZE

const DAY_MS = 24 * 60 * 60 * 1000

export interface MaintenanceReport {
  /** 删除的孤儿图片数 */
  orphan_images: number
  /** 因超过回收站保留期而墓碑化的笔记数 */
  expired_trash: number
  /** 物理删除的墓碑行数 */
  reaped_tombstones: number
}

/** 未配置 TRASH_RETENTION_DAYS 时的回收站保留天数 */
export const DEFAULT_TRASH_RETENTION_DAYS = 30

/**
 * 解析回收站保留天数。未设置或空串按默认 30 天；`0`、`off` 表示关闭；其余必须是正整数。
 * 非法值直接抛错：服务器版在启动时读取即可快速失败，Worker 则让本次 cron 报错，
 * 而不是悄悄按「关闭」或某个猜测值清理用户数据。
 */
export function parseTrashRetentionDays(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_TRASH_RETENTION_DAYS
  const text = String(value).trim().toLowerCase()
  if (text === '') return DEFAULT_TRASH_RETENTION_DAYS
  if (text === '0' || text === 'off' || text === 'false') return null
  if (!/^\d+$/.test(text)) throw new Error('TRASH_RETENTION_DAYS must be a positive integer number of days, or 0/off to disable')
  const days = Number(text)
  if (!Number.isSafeInteger(days) || days < 1) throw new Error('TRASH_RETENTION_DAYS must be a positive integer number of days, or 0/off to disable')
  return days
}

/**
 * 图片永久回收暂缓；在写入侧与对象删除可以协调之前保留已上传对象。
 */
export async function deleteOrphanImages(env: Env, now = nowMs()): Promise<string[]> {
  // A grace period cannot protect offline references; retain bytes for now.
  void env
  void now
  return []
}

/** 把进入回收站超过保留期的笔记墓碑化；`retentionDays` 为 null 时什么都不做。 */
export async function purgeExpiredTrash(env: Env, retentionDays: number | null, now = nowMs()): Promise<string[]> {
  if (retentionDays === null) return []
  const cutoff = now - retentionDays * DAY_MS
  // 进回收站时 setInvalid 会把 update_time 推到当时，回收站里的笔记不能再编辑，
  // 所以 update_time 就是进入回收站的时间。
  const { results } = await env.DB.prepare('SELECT id FROM note WHERE invalid = 1 AND update_time < ?')
    .bind(cutoff)
    .all<{ id: string }>()

  const ids = results.map((r) => r.id)
  for (let i = 0; i < ids.length; i += BATCH) {
    await purgeNotes(env, ids.slice(i, i + BATCH))
  }
  return ids
}

export async function runMaintenance(env: Env, now = nowMs()): Promise<MaintenanceReport> {
  const retention = parseTrashRetentionDays(env.TRASH_RETENTION_DAYS)
  await cleanupDeletedNotebookImages(env)
  // 正文及墓碑继续按保留期清理，图片保留且 orphan_images 固定为 0。
  const expired = await purgeExpiredTrash(env, retention, now)
  const orphans = await deleteOrphanImages(env, now)
  const reaped = await reapTombstones(env, now)
  return { orphan_images: orphans.length, expired_trash: expired.length, reaped_tombstones: reaped.length }
}
