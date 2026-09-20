export interface Segment {
  text: string
  hit: boolean
}

/** 把搜索框里的文字按空白切成关键词，去重并统一小写；空串返回空数组。 */
export function splitTerms(query: string): string[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return Array.from(new Set(terms))
}

/** 所有关键词都出现在 text 里才算命中；没有关键词视为命中。 */
export function matchesAll(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase()
  return terms.every((term) => lower.includes(term))
}

/**
 * 标出 text 里所有关键词的出现位置。多个关键词的命中区间会合并，
 * 因此「ab」与「bc」同时命中「abc」时整段是一个命中片段而不是两个重叠的。
 */
export function highlight(text: string, query: string): Segment[] {
  const terms = splitTerms(query)
  if (terms.length === 0 || !text) return [{ text, hit: false }]

  const lower = text.toLowerCase()
  const ranges: [number, number][] = []
  for (const term of terms) {
    let cursor = 0
    for (;;) {
      const idx = lower.indexOf(term, cursor)
      if (idx === -1) break
      ranges.push([idx, idx + term.length])
      cursor = idx + term.length
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }]

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }

  const segments: Segment[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false })
    segments.push({ text: text.slice(start, end), hit: true })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false })
  return segments
}
