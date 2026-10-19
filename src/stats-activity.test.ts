import { describe, expect, it } from 'vitest'
import { buildActivity } from './stats-activity'

const time = (date: string) => new Date(`${date}T12:00:00`).getTime()
const note = (created: string, updated = created, invalid = 0) => ({ create_time: time(created), update_time: time(updated), invalid })

describe('buildActivity', () => {
  it('includes both range boundaries, fills empty dates, and counts creation and latest update separately', () => {
    const { buckets, unit } = buildActivity(
      [
        note('2026-09-30', '2026-10-01'),
        note('2026-10-01', '2026-10-03'),
        note('2026-10-03'),
        note('2026-10-04'),
        note('2026-10-02', '2026-10-02', 2),
        { create_time: 0, update_time: NaN, invalid: 0 },
      ],
      '2026-10-01',
      '2026-10-03',
    )
    expect(unit).toBe('天')
    expect(buckets.map(({ created, updated }) => [created, updated])).toEqual([
      [1, 1],
      [0, 0],
      [1, 2],
    ])
  })

  it('aggregates longer ranges without losing notes at week/month boundaries', () => {
    const notes = [note('2026-01-01'), note('2026-01-07'), note('2026-01-08'), note('2026-02-01')]
    const weekly = buildActivity(notes, '2026-01-01', '2026-03-31')
    expect(weekly.unit).toBe('周')
    expect(weekly.buckets[0]).toEqual({ start: '2026-01-01', end: '2026-01-07', created: 2, updated: 2 })
    expect(weekly.buckets.reduce((sum, bucket) => sum + bucket.created, 0)).toBe(4)
    const monthly = buildActivity(notes, '2026-01-07', '2026-12-31')
    expect(monthly.unit).toBe('月')
    expect(monthly.buckets[0]).toEqual({ start: '2026-01-07', end: '2026-01-31', created: 2, updated: 2 })
    expect(monthly.buckets[1].created).toBe(1)
  })

  it('rejects missing, impossible and reversed dates and allows one-day ranges', () => {
    for (const [start, end] of [
      ['', '2026-10-01'],
      ['2026-02-30', '2026-03-01'],
      ['2026-10-02', '2026-10-01'],
    ]) {
      expect(buildActivity([], start, end).buckets).toEqual([])
    }
    expect(buildActivity([note('2026-10-01')], '2026-10-01', '2026-10-01').buckets).toHaveLength(1)
  })
})
