import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTICE_MS, dismissNotice, notice, notify, noticeAction, runNoticeAction } from './notify'

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

it('撤销入口停留五秒，动作只执行一次且新提示清除旧动作', async () => {
  const run = vi.fn()
  notify('已删除', { label: '撤销', run })
  vi.advanceTimersByTime(4999)
  expect(noticeAction.value?.label).toBe('撤销')
  await runNoticeAction()
  await runNoticeAction()
  expect(run).toHaveBeenCalledTimes(1)
  expect(notice.value).toBe('')
  notify('已删除', { label: '撤销', run })
  notify('已复制')
  expect(noticeAction.value).toBeNull()
  notify('已删除', { label: '撤销', run })
  vi.advanceTimersByTime(5000)
  expect(noticeAction.value).toBeNull()
})
