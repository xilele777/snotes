import { countWords } from '../../shared/derive'
import { db, type HistoryRow } from './schema'

/**
 * 本地正文历史（roadmap 第三档 5）。
 * 撤销栈随刷新消失、冲突副本只在多端同时改时出现，这里补一层兜底：每次正文落库时，
 * 若与上一条快照隔得够久或改动够大，就把**被替换的旧正文**存一条。
 * 纯本地：不同步、不导出；每条笔记最多保留 20 条且不超过 30 天；笔记物理删除时连带清理。
 */

export const HISTORY_MIN_INTERVAL_MS = 5 * 60_000
/** 与上一条快照相比，可见字符数变化达到这个值就立刻存一条，不等 5 分钟 */
export const HISTORY_CHAR_DELTA = 100
export const HISTORY_KEEP = 20
export const HISTORY_MAX_AGE_MS = 30 * 86_400_000

export type HistoryEntry = Required<HistoryRow>

/**
 * 是否该把 previous 存为快照（纯函数，便于测试）。
 * previous 为空或与 next 相同都不存；没有任何快照时存；与上一条快照正文相同不重复存；
 * 否则看时间间隔或字数变化是否达到阈值。
 */
export function shouldSnapshot(
  previous: string,
  next: string,
  last: { time: number; body: string } | undefined,
  now: number,
): boolean {
  if (!previous.trim() || previous === next) return false
  if (!last) return true
  if (last.body === previous) return false
  if (now - last.time >= HISTORY_MIN_INTERVAL_MS) return true
  return Math.abs(countWords(previous).chars - countWords(last.body).chars) >= HISTORY_CHAR_DELTA
}

/** 事务内部用：调用方的 db.transaction 必须包含 db.history */
export async function latestSnapshotIn(noteId: string): Promise<HistoryEntry | undefined> {
  const rows = await db.history.where('note_id').equals(noteId).sortBy('time')
  return rows.at(-1) as HistoryEntry | undefined
}

/** 事务内部用：写一条快照并按条数与时长修剪 */
export async function recordSnapshotIn(noteId: string, body: string, time: number): Promise<void> {
  await db.history.add({ note_id: noteId, time, body })
  const rows = await db.history.where('note_id').equals(noteId).sortBy('time')
  const stale = rows.filter((row, index) => rows.length - index > HISTORY_KEEP || time - row.time > HISTORY_MAX_AGE_MS)
  if (stale.length) await db.history.bulkDelete(stale.map((row) => row.id as number))
}

/**
 * 事务内部用：正文即将从 previous 换成 next，按规则决定是否留快照。
 * 快照时间取 previousTime（旧正文最后落库的时刻），列表里显示的才是「这一版是什么时候的」。
 */
export async function maybeSnapshotIn(
  noteId: string,
  previous: string,
  next: string,
  previousTime: number,
  now: number,
): Promise<boolean> {
  const last = await latestSnapshotIn(noteId)
  if (!shouldSnapshot(previous, next, last, now)) return false
  await recordSnapshotIn(noteId, previous, previousTime)
  return true
}

/** 事务内部用：笔记物理删除时连带清理 */
export async function deleteHistoryIn(noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return
  await db.history.where('note_id').anyOf(noteIds).delete()
}

/** 某条笔记的历史，最新的在前 */
export async function listHistory(noteId: string): Promise<HistoryEntry[]> {
  const rows = await db.history.where('note_id').equals(noteId).sortBy('time')
  return rows.reverse() as HistoryEntry[]
}

export function getHistoryEntry(id: number): Promise<HistoryEntry | undefined> {
  return db.history.get(id) as Promise<HistoryEntry | undefined>
}
