import { ref } from 'vue'
import { version as appVersion } from '../package.json'

/** 自托管者更新代码的来源仓库；发布页链接和版本检查都指向这里 */
export const REPO = 'xilele777/snotes'
export const RELEASES_URL = `https://github.com/${REPO}/releases`
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const STORAGE_KEY = 'snotes_update_check'
/** 成功结果缓存一天，避免每次开页都请求 GitHub */
const TTL_MS = 24 * 60 * 60 * 1000

export interface UpdateInfo {
  /** 线上最新发布版本号，不带 v 前缀 */
  latest: string
  /** 发布页地址，弹窗里直接可点 */
  url: string
  /** 最新版是否比当前运行的网页更新 */
  hasUpdate: boolean
}

interface CacheEntry { latest: string; url: string; checkedAt: number }

/**
 * 语义化版本比较：返回负数、0、正数分别表示 a 早于、等于、晚于 b。
 * 构建元数据不参与比较；预发布标识按 SemVer 的数字与字符串规则比较。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const normalized = v.replace(/^v/, '').split('+')[0]!
    const dash = normalized.indexOf('-')
    const core = dash < 0 ? normalized : normalized.slice(0, dash)
    const pre = dash < 0 ? null : normalized.slice(dash + 1)
    const nums = (core ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0)
    while (nums.length < 3) nums.push(0)
    return { nums, pre: pre ?? null }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i]! - pb.nums[i]!
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  const aParts = pa.pre.split('.')
  const bParts = pb.pre.split('.')
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const aPart = aParts[i]
    const bPart = bParts[i]
    if (aPart === bPart) continue
    if (aPart === undefined) return -1
    if (bPart === undefined) return 1
    const aNumeric = /^\d+$/.test(aPart)
    const bNumeric = /^\d+$/.test(bPart)
    if (aNumeric && bNumeric) return Number(aPart) - Number(bPart)
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return aPart < bPart ? -1 : 1
  }
  return 0
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*))*)?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/

function releaseUrl(value: unknown): string {
  return typeof value === 'string' && value.startsWith(`${RELEASES_URL}/tag/`) ? value : RELEASES_URL
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CacheEntry>
    if (typeof parsed.latest !== 'string' || !VERSION_PATTERN.test(parsed.latest) || typeof parsed.checkedAt !== 'number' || !Number.isFinite(parsed.checkedAt)) return null
    // 缓存里的「最新版」比当前运行的网页还旧，说明是升级前查到的结果，必然过时：
    // 既不能拿它跳过查询，也不能在请求失败时回退到它——否则会显示「最新版本」低于当前版本。
    if (compareVersions(parsed.latest, appVersion) < 0) return null
    return { latest: parsed.latest, url: releaseUrl(parsed.url), checkedAt: parsed.checkedAt }
  } catch {
    return null
  }
}

function toInfo(entry: CacheEntry): UpdateInfo {
  return { latest: entry.latest, url: entry.url, hasUpdate: compareVersions(entry.latest, appVersion) > 0 }
}

/** 最近一次检查结果；侧栏用它决定是否给版本按钮加提示点 */
export const updateInfo = ref<UpdateInfo | null>(null)

/**
 * 查询 GitHub 最新 Release。一天内复用本地缓存；网络失败或离线时回退到缓存，没有缓存则返回 null，
 * 版本检查只是提醒，绝不能影响笔记功能。
 */
export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  const cached = readCache()
  if (!options.force && cached && Date.now() >= cached.checkedAt && Date.now() - cached.checkedAt < TTL_MS) {
    updateInfo.value = toInfo(cached)
    return updateInfo.value
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    updateInfo.value = cached ? toInfo(cached) : null
    return updateInfo.value
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { tag_name?: string; html_url?: string }
    if (typeof body.tag_name !== 'string' || !VERSION_PATTERN.test(body.tag_name.replace(/^v/, ''))) throw new Error('bad payload')
    const entry: CacheEntry = {
      latest: body.tag_name.replace(/^v/, ''),
      url: releaseUrl(body.html_url),
      checkedAt: Date.now(),
    }
    updateInfo.value = toInfo(entry)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entry)) } catch { /* 缓存不可写时仍显示本次结果 */ }
  } catch {
    updateInfo.value = cached ? toInfo(cached) : null
  } finally {
    clearTimeout(timeout)
  }
  return updateInfo.value
}
