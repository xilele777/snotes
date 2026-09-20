import { db, type HistoryRow } from './schema'
import { apiFetch } from '../api/client'
import type { NoteHistoryResponse } from '../../shared/types'
import { HISTORY_KEEP, HISTORY_MAX_AGE_MS, shouldSnapshot } from '../../shared/history-rules'

export { HISTORY_CHAR_DELTA, HISTORY_KEEP, HISTORY_MAX_AGE_MS, HISTORY_MIN_INTERVAL_MS, shouldSnapshot } from '../../shared/history-rules'

/**
 * 本地正文历史（roadmap 第三档 5）。
 * 撤销栈随刷新消失、冲突副本只在多端同时改时出现，这里补一层兜底：每次正文落库时，
 * 若与上一条快照隔得够久或改动够大，就把**被替换的旧正文**存一条。
 * 留存规则见 shared/history-rules.ts，与云端 note_history 共用；笔记物理删除时连带清理。
 */

export type HistoryEntry = Required<HistoryRow>

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

export type HistorySource = 'local' | 'cloud'

/** 本机与云端合并后的一条历史：同一份正文两边都有时只显示一条，sources 同时标出 */
export interface MergedHistoryEntry {
  key: string
  time: number
  body: string
  sources: HistorySource[]
}

/** 纯函数：把本机与云端快照按正文去重合并，最新的在前 */
export function mergeHistory(
  local: { id: number; time: number; body: string }[],
  cloud: { id: number; time: number; body: string }[],
): MergedHistoryEntry[] {
  const merged: MergedHistoryEntry[] = local.map((row) => ({ key: `local-${row.id}`, time: row.time, body: row.body, sources: ['local'] }))
  for (const row of cloud) {
    const same = merged.find((entry) => entry.body === row.body)
    if (same) {
      if (!same.sources.includes('cloud')) same.sources.push('cloud')
      same.time = Math.max(same.time, row.time)
    } else {
      merged.push({ key: `cloud-${row.id}`, time: row.time, body: row.body, sources: ['cloud'] })
    }
  }
  return merged.sort((a, b) => b.time - a.time)
}

/** 云端历史。离线、旧服务端或笔记尚未推送时拿不到，一律当作空列表，不影响本机部分显示 */
export async function fetchCloudHistory(noteId: string): Promise<{ id: number; time: number; body: string }[]> {
  try {
    const response = await apiFetch<NoteHistoryResponse>(`/api/notes/${noteId}/history`, { method: 'GET' })
    return Array.isArray(response?.history) ? response.history : []
  } catch {
    return []
  }
}

/** 恢复前把此刻的正文补录到云端历史；失败只影响云端那一份，本机快照已在 repo 里存过 */
export async function recordCloudSnapshot(noteId: string, body: string, time: number): Promise<void> {
  try {
    await apiFetch(`/api/notes/${noteId}/history`, { method: 'POST', body: JSON.stringify({ body, time }) })
  } catch {
    /* 离线或旧服务端：忽略 */
  }
}
