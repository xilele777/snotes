import { describe, expect, it } from 'vitest'
import { BACKOFF_MAX_MS, backoffDelay, isRetriableStatus } from './backoff'

describe('backoffDelay', () => {
  it('从 1 秒开始按 2 的幂增长', () => {
    expect(backoffDelay(0)).toBe(1_000)
    expect(backoffDelay(1)).toBe(2_000)
    expect(backoffDelay(2)).toBe(4_000)
    expect(backoffDelay(3)).toBe(8_000)
  })

  it('封顶 600 秒', () => {
    expect(backoffDelay(20)).toBe(BACKOFF_MAX_MS)
    expect(backoffDelay(1000)).toBe(BACKOFF_MAX_MS)
  })

  it('负数按 0 处理，不返回 NaN 或负值', () => {
    expect(backoffDelay(-1)).toBe(1_000)
  })
})

describe('isRetriableStatus', () => {
  it('5xx 可重试', () => {
    expect(isRetriableStatus(500)).toBe(true)
    expect(isRetriableStatus(503)).toBe(true)
  })

  it('408 与 429 可重试', () => {
    expect(isRetriableStatus(408)).toBe(true)
    expect(isRetriableStatus(429)).toBe(true)
  })

  it('其余 4xx 不可重试', () => {
    expect(isRetriableStatus(400)).toBe(false)
    expect(isRetriableStatus(401)).toBe(false)
    expect(isRetriableStatus(404)).toBe(false)
  })

  it('2xx 不需要重试', () => {
    expect(isRetriableStatus(200)).toBe(false)
  })
})
