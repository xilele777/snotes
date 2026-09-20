/**
 * 登录限流（服务器版）。按来源地址记录 401 次数，达到阈值后封锁，
 * 封锁期满再失败则封锁时长翻倍，直到封顶；成功一次或长期沉默即清零。
 * 纯内存，进程重启即清空；多副本部署时各自计数，这对单用户自托管足够。
 * Cloudflare 版不走这里，由 WAF 速率限制规则承担（见 README「安全说明」）。
 */

export const LOGIN_FAIL_THRESHOLD = 5
export const LOGIN_BLOCK_BASE_MS = 60_000
export const LOGIN_BLOCK_MAX_MS = 60 * 60_000
/** 距上次失败超过这个时长，之前的失败次数不再累计 */
export const LOGIN_FORGET_MS = 15 * 60_000
const DEFAULT_MAX_ENTRIES = 10_000

interface Entry {
  fails: number
  blockedUntil: number
  blockMs: number
  last: number
}

export class LoginLimiter {
  private entries = new Map<string, Entry>()

  constructor(private maxEntries = DEFAULT_MAX_ENTRIES) {}

  get size() { return this.entries.size }
  keys() { return this.entries.keys() }

  /** 剩余封锁毫秒数；0 表示未封锁 */
  blockedFor(key: string, now = Date.now()): number {
    const entry = this.entries.get(key)
    if (!entry) return 0
    return Math.max(0, entry.blockedUntil - now)
  }

  /** 记录一次失败。返回本次触发的封锁时长（毫秒），未触发返回 0 */
  fail(key: string, now = Date.now()): number {
    let entry = this.entries.get(key)
    if (entry) {
      this.entries.delete(key)
      // 遗忘期从封锁结束算起：封锁期满后安静 15 分钟才回到初始状态
      if (now - Math.max(entry.last, entry.blockedUntil) > LOGIN_FORGET_MS) entry = undefined
    }
    entry ??= { fails: 0, blockedUntil: 0, blockMs: 0, last: now }
    entry.last = now
    entry.fails++
    // 已经封锁过一次的来源，封锁期满后再错一次就直接再封，不必重新攒满阈值
    if (entry.fails >= LOGIN_FAIL_THRESHOLD || entry.blockMs > 0) {
      entry.blockMs = entry.blockMs > 0 ? Math.min(entry.blockMs * 2, LOGIN_BLOCK_MAX_MS) : LOGIN_BLOCK_BASE_MS
      entry.blockedUntil = now + entry.blockMs
      entry.fails = 0
    }
    // Map 保持插入序：重新写入即移到末尾，超限时从头部淘汰最久没动的
    this.entries.set(key, entry)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return entry.blockedUntil > now ? entry.blockMs : 0
  }

  succeed(key: string): void {
    this.entries.delete(key)
  }
}

const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i

function normalize(address: string): string {
  const mapped = IPV4_MAPPED.exec(address)
  return mapped ? mapped[1] : address
}

/** 回环与私网地址：只有这些来源的 X-Forwarded-For 才可信（deploy/Caddyfile.example 与 compose 都是这种拓扑） */
export function isTrustedProxy(address: string): boolean {
  const ip = normalize(address)
  if (ip === '::1' || ip.startsWith('127.')) return true
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  const m172 = /^172\.(\d+)\./.exec(ip)
  if (m172) { const second = Number(m172[1]); return second >= 16 && second <= 31 }
  // fc00::/7（ULA）
  return /^f[cd][0-9a-f]{2}:/i.test(ip)
}

/**
 * 计算用于限流的客户端地址。
 * 直连（socket 对端不是可信代理）时只认 socket 地址，客户端自带的 X-Forwarded-For 一律忽略；
 * 经可信代理时从右往左跳过代理地址，取第一个外部地址；整条链路都是内网就取最左侧。
 */
export function clientAddress(remote: string | undefined, forwardedFor: string | undefined): string {
  if (!remote) return 'unknown'
  const socket = normalize(remote)
  if (!isTrustedProxy(socket)) return socket
  const hops = (forwardedFor ?? '').split(',').map((part) => normalize(part.trim())).filter(Boolean)
  if (hops.length === 0) return socket
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(hops[i])) return hops[i]
  }
  return hops[0]
}
