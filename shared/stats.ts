import { countWords } from './derive'
import type { LocalNote } from './types'

/** 一天在热力图上的格子数据 */
export interface HeatCell {
  /** 日期 yyyy-mm-dd */
  date: string
  /** 当天有更新的笔记数 */
  count: number
  /** 格子所在周列起始日期（yyyy-mm-dd），用于按周分组渲染 */
  weekStart: string
}

export interface NoteStats {
  /** 笔记总数（含回收站里的） */
  total: number
  /** 正常笔记数 */
  active: number
  /** 星标数 */
  starred: number
  /** 置顶数 */
  topped: number
  /** 回收站数 */
  trashed: number
  /** 全部正文可见字符总数 */
  totalChars: number
  /** 全部正文字数（CJK 按字 / 拉丁按词） */
  totalWords: number
  /** 创建时间最早的一条（null 表示无笔记） */
  earliest: number | null
  /** 最近一次更新时间 */
  latest: number | null
  /** 近 7 天每天新建数 */
  createdLast7: { date: string; count: number }[]
  /** 近 7 天每天更新数 */
  updatedLast7: { date: string; count: number }[]
  /** 近 53 周（约一年）更新热力图 */
  heatmap: HeatCell[]
  /** 分组笔记计数，按数量降序 */
  byGroup: { group_id: string; name: string; color: string | null; count: number }[]
  /** 最常打开的 5 条（打开次数降序） */
  mostOpened: { id: string; title: string; open_count: number }[]
}

const DAY_MS = 86_400_000

function ymd(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 周一作为一周起始（与 GitHub 热力图一致） */
function weekStartTs(ts: number): number {
  const d = new Date(ts)
  const day = d.getDay() || 7 // 0=周日 -> 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (day - 1))
  return d.getTime()
}

/** 构建最近 N 天的日期桶，key 为 yyyy-mm-dd */
function dayBuckets(days: number): Map<string, number> {
  const m = new Map<string, number>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    m.set(ymd(today.getTime() - i * DAY_MS), 0)
  }
  return m
}

/**
 * 纯函数计算笔记统计。所有输入一次性传入，内部不再读库，
 * 调用方 `db.notes.toArray()` 后调用即可，几千条规模下仍是毫秒级。
 *
 * 分组名/颜色需要调用方传入分组清单（避免这里反向依赖 stores），
 * 未分组统一记为「未分组」。
 */
export function computeNoteStats(
  notes: LocalNote[],
  groups: { group_id: string; name: string; color: string | null }[]
): NoteStats {
  const created7 = dayBuckets(7)
  const updated7 = dayBuckets(7)

  // 热力图：最近 371 天（53 周 × 7），按周列分组
  const weeks = 53
  const heatStart = weekStartTs(Date.now() - (weeks - 1) * 7 * DAY_MS)
  const heat = new Map<string, HeatCell>()
  for (let w = 0; w < weeks; w++) {
    const wsTs = heatStart + w * 7 * DAY_MS
    const wsDate = ymd(wsTs)
    for (let d = 0; d < 7; d++) {
      const dayTs = wsTs + d * DAY_MS
      const dayDate = ymd(dayTs)
      heat.set(dayDate, { date: dayDate, count: 0, weekStart: wsDate })
    }
  }

  let total = notes.length
  let active = 0
  let starred = 0
  let topped = 0
  let trashed = 0
  let totalChars = 0
  let totalWords = 0
  let earliest: number | null = null
  let latest: number | null = null

  const groupCount = new Map<string, number>()

  for (const n of notes) {
    if (n.invalid === 2) continue
    if (n.invalid === 1) trashed++
    else active++
    if (n.star === 1) starred++
    if (n.top === 1) topped++

    // 字数统计只算正常笔记，回收站内容不计入「写作量」
    if (n.invalid === 0) {
      const wc = countWords(n.body ?? '')
      totalWords += wc.words
      totalChars += wc.chars
    }

    if (n.create_time) {
      if (earliest === null || n.create_time < earliest) earliest = n.create_time
      const k = ymd(n.create_time)
      if (created7.has(k)) created7.set(k, (created7.get(k) ?? 0) + 1)
    }
    if (n.update_time) {
      if (latest === null || n.update_time > latest) latest = n.update_time
      const k = ymd(n.update_time)
      if (updated7.has(k)) updated7.set(k, (updated7.get(k) ?? 0) + 1)
      const cell = heat.get(k)
      if (cell) cell.count += 1
    }

    const gid = n.group_id ?? '__none__'
    groupCount.set(gid, (groupCount.get(gid) ?? 0) + 1)
  }

  const groupName = new Map<string, { name: string; color: string | null }>()
  groupName.set('__none__', { name: '未分组', color: null })
  for (const g of groups) groupName.set(g.group_id, { name: g.name, color: g.color })

  const byGroup = [...groupCount.entries()]
    .map(([gid, count]) => {
      const info = groupName.get(gid) ?? { name: gid, color: null }
      return { group_id: gid, name: info.name, color: info.color, count }
    })
    .sort((a, b) => b.count - a.count)

  const mostOpened = notes
    .filter((n) => n.invalid !== 2 && (n.open_count ?? 0) > 0)
    .map((n) => ({ id: n.id, title: n.title || '无标题', open_count: n.open_count ?? 0 }))
    .sort((a, b) => b.open_count - a.open_count)
    .slice(0, 5)

  return {
    total,
    active,
    starred,
    topped,
    trashed,
    totalChars,
    totalWords,
    earliest,
    latest,
    createdLast7: [...created7.entries()].map(([date, count]) => ({ date, count })),
    updatedLast7: [...updated7.entries()].map(([date, count]) => ({ date, count })),
    heatmap: [...heat.values()],
    byGroup,
    mostOpened,
  }
}
