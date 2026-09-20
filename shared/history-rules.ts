import { countWords } from './derive'

/**
 * 正文历史的留存规则，本机（IndexedDB）与云端（服务端 note_history 表）共用一份判定：
 * 正文即将被替换时，若与上一条快照隔得够久或改动够大，就把**被替换的旧正文**存一条。
 * 每条笔记最多保留 HISTORY_KEEP 条且不超过 HISTORY_MAX_AGE_MS。
 */
export const HISTORY_MIN_INTERVAL_MS = 5 * 60_000
/** 与上一条快照相比，可见字符数变化达到这个值就立刻存一条，不等 5 分钟 */
export const HISTORY_CHAR_DELTA = 100
export const HISTORY_KEEP = 20
export const HISTORY_MAX_AGE_MS = 30 * 86_400_000

/**
 * 是否该把 previous 存为快照（纯函数）。
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
