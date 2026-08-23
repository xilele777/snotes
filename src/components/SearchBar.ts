export interface Segment {
  text: string
  hit: boolean
}

export function highlight(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase()
  if (!q) return [{ text, hit: false }]

  const lower = text.toLowerCase()
  const segments: Segment[] = []
  let cursor = 0

  for (;;) {
    const idx = lower.indexOf(q, cursor)
    if (idx === -1) break

    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), hit: false })
    segments.push({ text: text.slice(idx, idx + q.length), hit: true })
    cursor = idx + q.length
  }

  if (cursor === 0) return [{ text, hit: false }]
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false })

  return segments
}
