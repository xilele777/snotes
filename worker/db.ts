import { HISTORY_KEEP, HISTORY_MAX_AGE_MS, shouldSnapshot } from '../shared/history-rules'
import type { NoteMeta } from '../shared/types'
import type { Env } from './types'
import { QUERY_BATCH_SIZE } from './query-limits'

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
    // 三态：NULL（或列还不存在）表示跟随分组，只有明确的 0/1 才是覆盖。
    // 注意不能用 Number(null) 判断——那是 0，会把「跟随」误读成「强制显示」。
    home_hidden:
      row.home_hidden === null || row.home_hidden === undefined
        ? null
        : Number(row.home_hidden) === 1 ? 1 : 0,
    // ?? 兜不住 NaN（NaN 不是 null）：先按驱动给的类型转数值，再白名单化
    invalid: [0, 1, 2].includes(Number(row.invalid)) ? (Number(row.invalid) as 0 | 1 | 2) : 0,
    create_time: Number(row.create_time),
    update_time: Number(row.update_time),
  }
}

/**
 * 把一批笔记物理删除「墓碑化」：note 行不立即 DELETE，而是置 invalid=2（墓碑态），
 * 递增 prop_version、更新 update_time——这样 pull 仍能返回这些行，客户端据此删掉
 * 本地副本，从而让「彻底删除 / 清空回收站」能跨端同步（Bug 2）。
 * 删除正文与历史；图片永久回收暂缓，避免离线和跨笔记引用丢图。
 */
export async function purgeNotes(env: Env, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  // D1 每条语句最多 100 个绑定参数；保留余量给时间等额外参数。
  const BATCH = QUERY_BATCH_SIZE
  for (let offset = 0; offset < ids.length; offset += BATCH) {
    await purgeNoteBatch(env, ids.slice(offset, offset + BATCH))
  }
}

async function purgeNoteBatch(env: Env, ids: string[]): Promise<void> {
  const placeholders = ids.map(() => '?').join(', ')
  const now = nowMs()

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM note_body WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note_open WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note_history WHERE note_id IN (${placeholders})`).bind(...ids),
    // 置墓碑：invalid=2 + 推进 prop_version/update_time，保留 id/version/prop_version
    // 等同步元字段，让 pull 客户端能识别这是「已被删除」的信号。
    env.DB.prepare(
      `UPDATE note SET invalid = 2, prop_version = prop_version + 1, update_time = ?
       WHERE id IN (${placeholders})`
    ).bind(now, ...ids),
  ])

  // Retain images until deletion can coordinate atomically with body writes.

}

/**
 * 真正回收超过保留期的墓碑行。墓碑只需存在到所有客户端都拉取过一次删除信号，
 * 保留期过后物理 DELETE，避免 note 表无限增长。
 *
 * 走 pull 时如果某客户端游标很旧，可能正好错过一个已被回收的墓碑——这种情况下
 * 新客户端通过更短有效期的 checkpoint 先全量对账；旧客户端仍可能留下旧副本，
 * 再次编辑遇到 404 时保留正文任务供恢复，不能仅依赖此保留期。
 */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export async function reapTombstones(env: Env, now = nowMs()): Promise<string[]> {
  const cutoff = now - TOMBSTONE_RETENTION_MS
  const { results } = await env.DB.prepare(
    'SELECT id FROM note WHERE invalid = 2 AND update_time < ?'
  )
    .bind(cutoff)
    .all<{ id: string }>()

  const ids = results.map((r) => r.id)
  if (ids.length === 0) return ids

  for (let offset = 0; offset < ids.length; offset += QUERY_BATCH_SIZE) {
    const slice = ids.slice(offset, offset + QUERY_BATCH_SIZE)
    const placeholders = slice.map(() => '?').join(', ')
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM note_body WHERE note_id IN (${placeholders})`).bind(...slice),
      env.DB.prepare(`DELETE FROM note_open WHERE note_id IN (${placeholders})`).bind(...slice),
      env.DB.prepare(`DELETE FROM note WHERE id IN (${placeholders})`).bind(...slice),
    ])
  }
  return ids
}

export interface HistoryRow {
  id: number
  note_id: string
  time: number
  body: string
}

/** 某条笔记的云端历史，最新的在前 */
export async function listNoteHistory(env: Env, noteId: string): Promise<HistoryRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, note_id, time, body FROM note_history WHERE note_id = ? ORDER BY time DESC, id DESC'
  )
    .bind(noteId)
    .all<HistoryRow>()
  return results
}

/** 最新的一条快照。去重比较用这一条就够，别为它拉整份历史（最多 20 条 × 1MB 正文）。 */
export async function latestNoteHistory(env: Env, noteId: string): Promise<HistoryRow | null> {
  return env.DB.prepare(
    'SELECT id, note_id, time, body FROM note_history WHERE note_id = ? ORDER BY time DESC, id DESC LIMIT 1'
  )
    .bind(noteId)
    .first<HistoryRow>()
}

/** 写一条云端快照并按条数与时长修剪 */
export async function recordNoteHistory(env: Env, noteId: string, body: string, time: number, now = nowMs()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO note_history (note_id, time, body) VALUES (?, ?, ?)').bind(noteId, time, body),
    env.DB.prepare(
      `DELETE FROM note_history WHERE note_id = ? AND (time < ? OR id NOT IN (
         SELECT id FROM note_history WHERE note_id = ? ORDER BY time DESC, id DESC LIMIT ?))`
    ).bind(noteId, now - HISTORY_MAX_AGE_MS, noteId, HISTORY_KEEP),
  ])
}

/**
 * 正文即将从 previous 换成 next，按共用规则决定是否留快照。
 * 快照时间取 previousTime（旧正文最后落库的时刻）。
 */
export async function maybeRecordNoteHistory(
  env: Env,
  noteId: string,
  previous: string,
  next: string,
  previousTime: number,
  now = nowMs()
): Promise<boolean> {
  const last = await env.DB.prepare(
    'SELECT time, body FROM note_history WHERE note_id = ? ORDER BY time DESC, id DESC LIMIT 1'
  )
    .bind(noteId)
    .first<{ time: number; body: string }>()
  if (!shouldSnapshot(previous, next, last ?? undefined, now)) return false
  await recordNoteHistory(env, noteId, previous, previousTime, now)
  return true
}
