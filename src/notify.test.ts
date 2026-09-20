import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTICE_MS, dismissNotice, notice, notify } from './notify'

// 本模块不碰 Dexie，可以放心用 fake timers
beforeEach(() => {
  vi.useFakeTimers()
  dismissNotice()
})
afterEach(() => vi.useRealTimers())

describe('notify', () => {
  it('显示文字，3.5 秒后自动消失', () => {
    notify('已复制 Markdown')
    expect(notice.value).toBe('已复制 Markdown')
    vi.advanceTimersByTime(NOTICE_MS - 1)
    expect(notice.value).toBe('已复制 Markdown')
    vi.advanceTimersByTime(1)
    expect(notice.value).toBe('')
  })

  it('新消息替换旧消息并重新计时，同一时刻只有一条', () => {
    notify('第一条')
    vi.advanceTimersByTime(2000)
    notify('第二条')
    expect(notice.value).toBe('第二条')
    // 旧计时器已作废：再过 1.5 秒不会把第二条清掉
    vi.advanceTimersByTime(1600)
    expect(notice.value).toBe('第二条')
    vi.advanceTimersByTime(NOTICE_MS)
    expect(notice.value).toBe('')
  })

  it('dismissNotice 立即清掉', () => {
    notify('要被清的')
    dismissNotice()
    expect(notice.value).toBe('')
  })
})
