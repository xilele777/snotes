import { describe, expect, it } from 'vitest'
import {
  LOGIN_BLOCK_BASE_MS, LOGIN_BLOCK_MAX_MS, LOGIN_FAIL_THRESHOLD, LOGIN_FORGET_MS, LoginLimiter, clientAddress,
} from '../../server/rate-limit'

describe('LoginLimiter', () => {
  it('阈值之前放行，达到阈值后封锁一个基础周期', () => {
    const limiter = new LoginLimiter()
    for (let i = 1; i < LOGIN_FAIL_THRESHOLD; i++) {
      expect(limiter.fail('1.1.1.1', 1_000 * i)).toBe(0)
      expect(limiter.blockedFor('1.1.1.1', 1_000 * i)).toBe(0)
    }
    expect(limiter.fail('1.1.1.1', 10_000)).toBe(LOGIN_BLOCK_BASE_MS)
    expect(limiter.blockedFor('1.1.1.1', 10_000 + LOGIN_BLOCK_BASE_MS - 1)).toBe(1)
    expect(limiter.blockedFor('1.1.1.1', 10_000 + LOGIN_BLOCK_BASE_MS)).toBe(0)
  })

  it('封锁期满后再失败，封锁时长翻倍并封顶', () => {
    const limiter = new LoginLimiter()
    let now = 0
    for (let i = 0; i < LOGIN_FAIL_THRESHOLD; i++) limiter.fail('k', now)
    expect(limiter.blockedFor('k', now)).toBe(LOGIN_BLOCK_BASE_MS)
    now += LOGIN_BLOCK_BASE_MS
    expect(limiter.fail('k', now)).toBe(LOGIN_BLOCK_BASE_MS * 2)
    now += LOGIN_BLOCK_BASE_MS * 2
    expect(limiter.fail('k', now)).toBe(LOGIN_BLOCK_BASE_MS * 4)
    let block = LOGIN_BLOCK_BASE_MS * 4
    for (let i = 0; i < 10; i++) {
      now += block
      block = limiter.fail('k', now)
      expect(block).toBeLessThanOrEqual(LOGIN_BLOCK_MAX_MS)
    }
    expect(block).toBe(LOGIN_BLOCK_MAX_MS)
    // 封锁期满后安静超过遗忘期，回到初始状态：单次失败不再封锁
    expect(limiter.fail('k', now + block + LOGIN_FORGET_MS + 1)).toBe(0)
  })

  it('成功一次或长期沉默后清零；不同来源互不影响', () => {
    const limiter = new LoginLimiter()
    for (let i = 0; i < LOGIN_FAIL_THRESHOLD; i++) limiter.fail('a', 0)
    expect(limiter.blockedFor('a', 0)).toBeGreaterThan(0)
    expect(limiter.blockedFor('b', 0)).toBe(0)
    limiter.succeed('a')
    expect(limiter.blockedFor('a', 0)).toBe(0)
    expect(limiter.fail('a', 1)).toBe(0)

    for (let i = 0; i < LOGIN_FAIL_THRESHOLD - 1; i++) limiter.fail('c', 0)
    // 沉默超过遗忘期，之前的失败不再累计
    expect(limiter.fail('c', LOGIN_FORGET_MS + 1)).toBe(0)
    expect(limiter.size).toBe(2)
  })

  it('记录条数有上限，最久没动的先被淘汰', () => {
    const limiter = new LoginLimiter(3)
    limiter.fail('a', 0)
    limiter.fail('b', 1)
    limiter.fail('c', 2)
    limiter.fail('a', 3)
    limiter.fail('d', 4)
    expect(limiter.size).toBe(3)
    expect([...limiter.keys()]).toEqual(['c', 'a', 'd'])
  })
})

describe('clientAddress', () => {
  it('直连时只认 socket 地址，忽略客户端自带的 X-Forwarded-For', () => {
    expect(clientAddress('203.0.113.9', '1.2.3.4')).toBe('203.0.113.9')
    expect(clientAddress('::ffff:203.0.113.9', undefined)).toBe('203.0.113.9')
    expect(clientAddress(undefined, '1.2.3.4')).toBe('unknown')
  })

  it('来自本机或内网反向代理时，取代理追加的最右侧非代理地址', () => {
    expect(clientAddress('127.0.0.1', '198.51.100.7')).toBe('198.51.100.7')
    expect(clientAddress('::1', 'spoofed, 198.51.100.7')).toBe('198.51.100.7')
    expect(clientAddress('172.18.0.1', '198.51.100.7, 10.0.0.5')).toBe('198.51.100.7')
    expect(clientAddress('::ffff:172.18.0.1', '198.51.100.7')).toBe('198.51.100.7')
    // 代理没带头：退回 socket 地址
    expect(clientAddress('127.0.0.1', undefined)).toBe('127.0.0.1')
    expect(clientAddress('127.0.0.1', '  ')).toBe('127.0.0.1')
    // 整条链路都是内网（家庭局域网直接访问）：取最左侧
    expect(clientAddress('127.0.0.1', '192.168.1.20, 10.0.0.5')).toBe('192.168.1.20')
  })
})
