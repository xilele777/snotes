import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { useUiStore } from '../stores/ui'
import { POLL_INTERVAL_MS, LOCAL_WRITE_DEBOUNCE_MS, startSyncEngine, syncNow } from './engine'
import { emitLocalWrite } from './signal'

const pushOnce = vi.hoisted(() => vi.fn())
const pullOnce = vi.hoisted(() => vi.fn())
const saveConflictCopies = vi.hoisted(() => vi.fn())

vi.mock('./push', () => ({ pushOnce }))
vi.mock('./pull', () => ({ pullOnce, SYNC_CURSOR_KEY: 'sync_cursor' }))
vi.mock('./conflict', () => ({ saveConflictCopies, CONFLICT_SUFFIX: '（冲突副本）' }))

let stop: (() => void) | undefined

/**
 * visibilityState 是定义在 Document.prototype 上的 getter，
 * vi.spyOn(document, ...) 找不到自有属性会直接抛错，必须自己 defineProperty。
 */
function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  vi.useFakeTimers()
  setVisibility('visible')

  pushOnce.mockReset().mockResolvedValue({ sent: 0, failed: 0, failedTotal: 0, conflicts: [] })
  pullOnce.mockReset().mockResolvedValue({ pages: 1, applied: 0, bodies: 0 })
  saveConflictCopies.mockReset().mockResolvedValue([])
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
})

describe('syncNow', () => {
  it('先 push 再 pull', async () => {
    const order: string[] = []
    pushOnce.mockImplementation(async () => {
      order.push('push')
      return { sent: 0, failed: 0, failedTotal: 0, conflicts: [] }
    })
    pullOnce.mockImplementation(async () => {
      order.push('pull')
      return { pages: 1, applied: 0, bodies: 0 }
    })

    await syncNow()

    expect(order).toEqual(['push', 'pull'])
  })

  it('push 报告冲突时生成副本', async () => {
    pushOnce.mockResolvedValue({
      sent: 1,
      failed: 0,
      failedTotal: 0,
      conflicts: [{ note_id: 'n1', local_body: '本地' }],
    })

    await syncNow()

    expect(saveConflictCopies).toHaveBeenCalledWith([{ note_id: 'n1', local_body: '本地' }])
  })

  it('把失败任务数写进 ui.failedCount', async () => {
    const ui = useUiStore()
    pushOnce.mockResolvedValue({ sent: 0, failed: 2, failedTotal: 2, conflicts: [] })

    await syncNow()

    // 不写进 store 的话，任务失败对用户就是完全不可见的
    expect(ui.failedCount).toBe(2)
  })

  it('并发调用被合并，不会重入', async () => {
    let resolvePush: (() => void) | undefined
    pushOnce.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = () => resolve({ sent: 0, failed: 0, failedTotal: 0, conflicts: [] })
        })
    )

    const first = syncNow()
    const second = syncNow()

    resolvePush!()
    await Promise.all([first, second])

    expect(pushOnce).toHaveBeenCalledTimes(1)
  })

  it('同步期间置 syncing 标志，结束后复位', async () => {
    const ui = useUiStore()
    let resolvePull: (() => void) | undefined
    pullOnce.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve({ pages: 1, applied: 0, bodies: 0 })
        })
    )

    const promise = syncNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(ui.syncing).toBe(true)

    resolvePull!()
    await promise
    expect(ui.syncing).toBe(false)
  })

  it('失败时记录错误且不抛给调用方', async () => {
    const ui = useUiStore()
    pullOnce.mockRejectedValue(new Error('网络挂了'))

    await expect(syncNow()).resolves.toBeUndefined()
    expect(ui.lastSyncError).toContain('网络挂了')
  })

  it('成功后清除上一次的错误', async () => {
    const ui = useUiStore()
    ui.lastSyncError = '旧错误'

    await syncNow()

    expect(ui.lastSyncError).toBeNull()
  })
})

describe('startSyncEngine', () => {
  it('启动时立即同步一次', async () => {
    stop = startSyncEngine()
    await vi.advanceTimersByTimeAsync(0)

    expect(pullOnce).toHaveBeenCalledTimes(1)
  })

  it('每 30 秒轮询一次', async () => {
    stop = startSyncEngine()
    await vi.advanceTimersByTimeAsync(0)
    pullOnce.mockClear()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(pullOnce).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(pullOnce).toHaveBeenCalledTimes(2)
  })

  it('页面重新可见时同步', async () => {
    stop = startSyncEngine()
    await vi.advanceTimersByTimeAsync(0)
    pullOnce.mockClear()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(pullOnce).toHaveBeenCalledTimes(1)
  })

  it('页面隐藏时不同步', async () => {
    stop = startSyncEngine()
    await vi.advanceTimersByTimeAsync(0)
    pullOnce.mockClear()

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(pullOnce).not.toHaveBeenCalled()
  })

  it('本地写入后 800ms 触发一次同步（规格 8.3 的第五个触发点）', async () => {
    stop = startSyncEngine()
    await vi.advanceTimersByTimeAsync(0)
    pushOnce.mockClear()

    emitLocalWrite()
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_DEBOUNCE_MS - 1)
    expect(pushOnce).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(pushOnce).toHaveBeenCalledTimes(1)
  })

  it('连续本地写入只在停下来之后推一次', async () => {
    stop = startSyncEngine()
    await vi.advanceTimersByTimeAsync(0)
    pushOnce.mockClear()

    for (let i = 0; i < 5; i++) {
      emitLocalWrite()
      await vi.advanceTimersByTimeAsync(300)
    }
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_DEBOUNCE_MS)

    // 不 debounce 的话，连续敲字每次落库都会打一个请求
    expect(pushOnce).toHaveBeenCalledTimes(1)
  })

  it('网络恢复时同步', async () => {
    stop = startSyncEngine()
    await vi.advanceTimersByTimeAsync(0)
    pushOnce.mockClear()

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)

    expect(pushOnce).toHaveBeenCalledTimes(1)
  })

  it('停止后不再轮询也不再响应事件', async () => {
    stop = startSyncEngine()
    await vi.advanceTimersByTimeAsync(0)

    stop()
    stop = undefined
    pullOnce.mockClear()
    pushOnce.mockClear()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    window.dispatchEvent(new Event('online'))
    emitLocalWrite()
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_DEBOUNCE_MS * 2)

    expect(pullOnce).not.toHaveBeenCalled()
    expect(pushOnce).not.toHaveBeenCalled()
  })
})
