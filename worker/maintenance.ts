import { nowMs, purgeNotes, reapTombstones } from './db'
import type { Env } from './types'

/**
 * 定时维护任务。Worker 的 `scheduled` 处理器与服务器版的 setInterval 都调用这一份函数，
 * 与 `createApp` 一样由两端共用。
 *
 * 三件事按顺序执行：
 * 1. 回收孤儿图片：`image` 表里的对象已不再被所属笔记正文引用，且上传超过宽限期。
 * 2. 清理过期回收站：`invalid = 1` 且进入回收站超过保留期的笔记走 purgeNotes 墓碑化。
 *    保留期是部署级配置（TRASH_RETENTION_DAYS），默认关闭。
 * 3. 回收超过保留期的墓碑行，不再依赖用户手动「清空回收站」。
 */

/** 孤儿图片的宽限期：避开撤销与多端同步的时序，上传不满 7 天的一律不动。 */
export const ORPHAN_IMAGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

/** 一次展开进 IN 的 id 数量。SQLite 默认最多 999 个绑定参数，留足余量。 */
const BATCH = 200

const DAY_MS = 24 * 60 * 60 * 1000

export interface MaintenanceReport {
  /** 删除的孤儿图片数 */
  orphan_images: number
  /** 因超过回收站保留期而墓碑化的笔记数 */
  expired_trash: number
  /** 物理删除的墓碑行数 */
  reaped_tombstones: number
}

/**
 * 解析回收站保留天数。未设置、空串、`0`、`off` 都表示关闭；其余必须是正整数。
 * 非法值直接抛错：服务器版在启动时读取即可快速失败，Worker 则让本次 cron 报错，
 * 而不是悄悄按「关闭」或某个猜测值清理用户数据。
 */
export function parseTrashRetentionDays(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim().toLowerCase()
  if (text === '' || text === '0' || text === 'off' || text === 'false') return null
  if (!/^\d+$/.test(text)) throw new Error('TRASH_RETENTION_DAYS must be a positive integer number of days, or empty to disable')
  const days = Number(text)
  if (!Number.isSafeInteger(days) || days < 1) throw new Error('TRASH_RETENTION_DAYS must be a positive integer number of days, or empty to disable')
  return days
}

/**
 * 删除不再被正文引用的图片。
 *
 * 只对比图片所属笔记（上传时记录的 note_id）的正文：正文不存在（笔记已墓碑化或已删除）
 * 或正文里找不到 `/api/images/<file_key>` 即视为孤儿。跨笔记复制 Markdown 时图片仍挂在
 * 原笔记名下，这与 purgeNotes 按 note_id 回收的既有约定一致。
 */
export async function deleteOrphanImages(env: Env, now = nowMs()): Promise<string[]> {
  const cutoff = now - ORPHAN_IMAGE_GRACE_MS
  const { results } = await env.DB.prepare(
    `SELECT i.file_key FROM image i
     LEFT JOIN note_body b ON b.note_id = i.note_id
     WHERE i.create_time < ? AND (b.content IS NULL OR instr(b.content, '/api/images/' || i.file_key) = 0)`
  )
    .bind(cutoff)
    .all<{ file_key: string }>()

  const keys = results.map((r) => r.file_key)
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH)
    // 先删对象再删索引行：对象删除失败时索引仍在，下次任务会重试；反过来会留下永远找不到的对象。
    await Promise.all(slice.map((key) => env.R2.delete(key)))
    await env.DB.prepare(`DELETE FROM image WHERE file_key IN (${slice.map(() => '?').join(', ')})`)
      .bind(...slice)
      .run()
  }
  return keys
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
  // 先清回收站再扫图片：刚墓碑化的笔记正文已删，其图片在 purgeNotes 里已经回收，
  // 顺序反过来也不会错，只是多扫一遍。
  const expired = await purgeExpiredTrash(env, retention, now)
  const orphans = await deleteOrphanImages(env, now)
  const reaped = await reapTombstones(env, now)
  return { orphan_images: orphans.length, expired_trash: expired.length, reaped_tombstones: reaped.length }
}
