export interface ActivityBucket {
  start: string
  end: string
  created: number
  updated: number
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime()) && localDateKey(date) === value ? date : null
}

/** Snapshot counts by creation/latest update date; these are notes, not edit events.
 * Longer ranges use weekly/monthly buckets so bars stay readable. */
export function buildActivity(
  notes: readonly { invalid: number; create_time: number; update_time: number }[],
  start: string,
  end: string,
): { buckets: ActivityBucket[]; unit: '天' | '周' | '月' } {
  const from = parseDate(start)
  const to = parseDate(end)
  const empty = { buckets: [], unit: '天' as const }
  if (!from || !to || start > end) return empty
  const days =
    Math.round(
      (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
        86_400_000,
    ) + 1
  const unit = days > 93 ? '月' : days > 31 ? '周' : '天'
  const buckets: ActivityBucket[] = []
  const dayToBucket = new Map<string, ActivityBucket>()
  let bucket: ActivityBucket | undefined
  let index = 0
  // Advance calendar dates, not fixed milliseconds, across daylight-saving changes.
  for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1), index++) {
    const key = localDateKey(cursor)
    const newBucket =
      !bucket || unit === '天' || (unit === '周' && index % 7 === 0) || (unit === '月' && key.slice(0, 7) !== bucket.start.slice(0, 7))
    if (newBucket) {
      bucket = { start: key, end: key, created: 0, updated: 0 }
      buckets.push(bucket)
    }
    bucket!.end = key
    dayToBucket.set(key, bucket!)
  }
  for (const note of notes) {
    if (note.invalid === 2) continue
    for (const [field, timestamp] of [
      ['created', note.create_time],
      ['updated', note.update_time],
    ] as const) {
      if (!Number.isFinite(timestamp) || timestamp <= 0) continue
      const match = dayToBucket.get(localDateKey(new Date(timestamp)))
      if (match) match[field]++
    }
  }
  return { buckets, unit }
}
