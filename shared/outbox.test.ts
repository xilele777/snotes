import { describe, expect, it } from 'vitest'
import type { OutboxTask } from './types'
import { mergeTask } from './outbox'

const base = (over: Partial<OutboxTask> = {}): OutboxTask => ({
  note_id: 'n1',
  kind: 'body',
  payload: { content: '旧' },
  retry: 0,
  next_at: 0,
  seq: 0,
  failed: 0,
  ...over,
})

describe('mergeTask', () => {
  it('没有既有任务时 seq 从 1 起算', () => {
    expect(mergeTask(undefined, base())).toMatchObject({ ...base(), seq: 1 })
  })

  it('保留既有任务的自增主键', () => {
    const existing = base({ id: 7 })
    const merged = mergeTask(existing, base({ payload: { content: '新' } }))
    expect(merged.id).toBe(7)
  })

  it('采用最新的 payload', () => {
    const merged = mergeTask(base({ payload: { content: '旧' } }), base({ payload: { content: '新' } }))
    expect(merged.payload).toEqual({ content: '新' })
  })

  it('新编辑重置退避，使其立即可发', () => {
    const existing = base({ retry: 5, next_at: 999_999 })
    const merged = mergeTask(existing, base({ payload: { content: '新' } }))
    expect(merged.retry).toBe(0)
    expect(merged.next_at).toBe(0)
  })

  it('新编辑清除失败标记——用户改完就该自动重试', () => {
    const merged = mergeTask(base({ failed: 1, retry: 3 }), base({ payload: { content: '新' } }))
    expect(merged.failed).toBe(0)
  })

  it('每次合并都推进 seq，push 据此发现「发出去之后又被改过」', () => {
    const merged = mergeTask(base({ id: 1, seq: 4 }), base({ payload: { content: '新' } }))
    expect(merged.seq).toBe(5)
  })

  it('连续多次合并只保留最后一次 payload，seq 单调递增', () => {
    let task = base({ id: 1, payload: { content: 'a' } })
    for (const c of ['b', 'c', 'd']) {
      task = mergeTask(task, base({ payload: { content: c } }))
    }
    expect(task.payload).toEqual({ content: 'd' })
    expect(task.id).toBe(1)
    expect(task.seq).toBe(3)
  })
})
