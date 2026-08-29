import type { NoteMeta } from '../shared/types'
import type { Env } from './types'

export function nowMs(): number {
  return Date.now()
}

/** D1 行（字段值可能是 number/string/null）映射为 NoteMeta。 */
export function rowToNoteMeta(row: Record<string, unknown>): NoteMeta {
  return {
    id: row.id as string,
    group_id: (row.group_id as string | null) ?? null,
    title: (row.title as string) ?? '',
    summary: (row.summary as string) ?? '',
    thumbnail: (row.thumbnail as string | null) ?? null,
    version: Number(row.version),
    prop_version: Number(row.prop_version),
    star: Number(row.star) === 1 ? 1 : 0,
    top: Number(row.top) === 1 ? 1 : 0,
    skin_color: (row.skin_color as string | null) ?? null,
    invalid: (Number(row.invalid) as 0 | 1 | 2) ?? 0,
    create_time: Number(row.create_time),
    update_time: Number(row.update_time),
  }
}

/**
 * 把一批笔记物理删除「墓碑化」：note 行不立即 DELETE，而是置 invalid=2（墓碑态），
 * 递增 prop_version、更新 update_time——这样 pull 仍能返回这些行，客户端据此删掉
 * 本地副本，从而让「彻底删除 / 清空回收站」能跨端同步（Bug 2）。
 * 正文与图片在墓碑化时即回收：墓碑只剩元数据，不再需要正文，图片也不再被引用。
 */
export async function purgeNotes(env: Env, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const placeholders = ids.map(() => '?').join(', ')

  // 先回收 R2 图片（墓碑化后这些图永不再被引用）
  const { results } = await env.DB.prepare(
    `SELECT file_key FROM image WHERE note_id IN (${placeholders})`
  )
    .bind(...ids)
    .all<{ file_key: string }>()

  await Promise.all(results.map((r) => env.R2.delete(r.file_key)))

  const now = nowMs()

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM image WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note_body WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note_open WHERE note_id IN (${placeholders})`).bind(...ids),
    // 置墓碑：invalid=2 + 推进 prop_version/update_time，保留 id/version/prop_version
    // 等同步元字段，让 pull 客户端能识别这是「已被删除」的信号。
    env.DB.prepare(
      `UPDATE note SET invalid = 2, prop_version = prop_version + 1, update_time = ?
       WHERE id IN (${placeholders})`
    ).bind(now, ...ids),
  ])
}

/**
 * 真正回收超过保留期的墓碑行。墓碑只需存在到所有客户端都拉取过一次删除信号，
 * 保留期过后物理 DELETE，避免 note 表无限增长。
 *
 * 走 pull 时如果某客户端游标很旧，可能正好错过一个已被回收的墓碑——这种情况下
 * 它本地会一直留着一条「远端已不存在」的笔记；下次它对该笔记做任何本地改动并推送，
 * 服务端会回 not_found（行已不存在），push 据此丢弃任务，不会卡死。保留期设得足够长
 * （默认 30 天）能把这个窗口压到极小。
 */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export async function reapTombstones(env: Env): Promise<string[]> {
  const cutoff = nowMs() - TOMBSTONE_RETENTION_MS
  const { results } = await env.DB.prepare(
    'SELECT id FROM note WHERE invalid = 2 AND update_time < ?'
  )
    .bind(cutoff)
    .all<{ id: string }>()

  const ids = results.map((r) => r.id)
  if (ids.length === 0) return ids

  const placeholders = ids.map(() => '?').join(', ')
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM image WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note_body WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note_open WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note WHERE id IN (${placeholders})`).bind(...ids),
  ])
  return ids
}
