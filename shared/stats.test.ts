import { describe, expect, it } from 'vitest'
import { computeNoteStats } from './stats'
import type { LocalNote } from './types'

function makeNote(over: Partial<LocalNote> & { id: string }): LocalNote {
  return {
    group_id: null,
    title: '',
    summary: '',
    thumbnail: null,
    version: 1,
    prop_version: 1,
    star: 0,
    top: 0,
    skin_color: null,
    invalid: 0,
    create_time: 0,
    update_time: 0,
    body: '',
    body_version: 1,
    dirty: 'none',
    ...over,
  }
}

describe('computeNoteStats', () => {
  it('空笔记列表返回零值统计', () => {
    const s = computeNoteStats([], [])
    expect(s.total).toBe(0)
    expect(s.active).toBe(0)
    expect(s.totalWords).toBe(0)
    expect(s.mostOpened).toEqual([])
  })

  it('统计正常 / 星标 / 置顶 / 回收站数量', () => {
    const notes = [
      makeNote({ id: 'a', star: 1 }),
      makeNote({ id: 'b', top: 1 }),
      makeNote({ id: 'c', invalid: 1 }),
      makeNote({ id: 'd' }),
    ]
    const s = computeNoteStats(notes, [])
    expect(s.active).toBe(3)
    expect(s.trashed).toBe(1)
    expect(s.starred).toBe(1)
    expect(s.topped).toBe(1)
  })

  it('字数只统计正常笔记', () => {
    const notes = [
      makeNote({ id: 'a', body: '今天天气不错' }),
      makeNote({ id: 'b', invalid: 1, body: '回收站内容不计' }),
    ]
    const s = computeNoteStats(notes, [])
    expect(s.totalWords).toBe(6)
  })

  it('按分组计数并降序排列，未分组归入「未分组」', () => {
    const notes = [
      makeNote({ id: 'a', group_id: 'g1' }),
      makeNote({ id: 'b', group_id: 'g1' }),
      makeNote({ id: 'c', group_id: null }),
    ]
    const groups = [{ group_id: 'g1', name: '工作', color: '#f00' as const }]
    const s = computeNoteStats(notes, groups)
    expect(s.byGroup.map((g) => g.group_id)).toEqual(['g1', '__none__'])
    expect(s.byGroup.map((g) => g.name)).toEqual(['工作', '未分组'])
    expect(s.byGroup[0].count).toBe(2)
  })

  it('最常打开按 open_count 降序取前 5，0 次不计', () => {
    const notes = Array.from({ length: 7 }, (_, i) =>
      makeNote({ id: `n${i}`, title: `笔记${i}`, open_count: i })
    )
    const s = computeNoteStats(notes, [])
    expect(s.mostOpened).toHaveLength(5)
    expect(s.mostOpened[0].total_count).toBe(6)
    expect(s.mostOpened[0].title).toBe('笔记6')
  })

  it('热力图生成 53 周格子，当天更新落在对应格子', () => {
    const now = Date.now()
    const notes = [makeNote({ id: 'a', update_time: now })]
    const s = computeNoteStats(notes, [])
    expect(s.heatmap.length).toBe(53 * 7)
    const today = new Date(now)
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    const cell = s.heatmap.find((c) => c.date === todayKey)
    expect(cell).toBeDefined()
    expect(cell!.count).toBe(1)
  })

  it('earliest / latest 取创建与更新极值', () => {
    const notes = [
      makeNote({ id: 'a', create_time: 100, update_time: 200 }),
      makeNote({ id: 'b', create_time: 50, update_time: 300 }),
    ]
    const s = computeNoteStats(notes, [])
    expect(s.earliest).toBe(50)
    expect(s.latest).toBe(300)
  })

  it('统计连续写作、时段、长度分布和跨设备打开排序', () => {
    const now = new Date()
    now.setHours(23, 0, 0, 0)
    const yesterday = now.getTime() - 86_400_000
    const atMidnight = new Date(now)
    atMidnight.setHours(0, 0, 0, 0)
    const notes = [
      makeNote({ id: 'a', body: '字'.repeat(99), update_time: yesterday, open_count: 1, open_others: 8, last_open_time: 1, open_others_time: 30 }),
      makeNote({ id: 'b', body: '字'.repeat(100), update_time: atMidnight.getTime(), open_count: 3, open_others: 1, last_open_time: 40 }),
      makeNote({ id: 'c', body: '字'.repeat(500), update_time: now.getTime() }),
      makeNote({ id: 'd', body: '字'.repeat(2000), update_time: now.getTime() }),
    ]
    const s = computeNoteStats(notes, [])
    expect(s.streakCurrent).toBe(2)
    expect(s.byHour[0]).toBe(1)
    expect(s.byHour[23]).toBe(3)
    expect(s.lengthBuckets.map((b) => b.count)).toEqual([1, 1, 1, 1])
    expect(s.mostOpened[0]).toMatchObject({ id: 'a', total_count: 9 })
    expect(s.recentOpened[0]).toMatchObject({ id: 'b', time: 40 })
  })
})
