import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { version as appVersion } from '../package.json'
import { checkForUpdate, compareVersions, updateInfo } from './update-check'

const bump = (v: string, patch = 1) => {
  const [a, b, c] = v.split(/[+-]/)[0]!.split('.').map(Number)
  return `${a}.${b}.${(c ?? 0) + patch}`
}

function release(tag: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/xilele777/snotes/releases/tag/${tag}` }), { status })
  )
}

beforeEach(() => {
  localStorage.clear()
  updateInfo.value = null
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-16T08:00:00Z'))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('compareVersions', () => {
  it('按 MAJOR.MINOR.PATCH 数字比较，忽略 v 前缀', () => {
    expect(compareVersions('v0.6.3', '0.6.3')).toBe(0)
    expect(compareVersions('0.6.10', '0.6.9')).toBeGreaterThan(0)
    expect(compareVersions('0.7.0', '0.6.99')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.6.2', '0.6.3')).toBeLessThan(0)
  })

  it('预发布版本早于同号正式版', () => {
    expect(compareVersions('0.7.0-beta.1', '0.7.0')).toBeLessThan(0)
    expect(compareVersions('0.7.0', '0.7.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('0.7.0-beta.1', '0.6.3')).toBeGreaterThan(0)
    expect(compareVersions('0.7.0-beta.10', '0.7.0-beta.2')).toBeGreaterThan(0)
    expect(compareVersions('0.7.0-beta.1', '0.7.0-beta')).toBeGreaterThan(0)
    expect(compareVersions('0.7.0-1', '0.7.0-alpha')).toBeLessThan(0)
    expect(compareVersions('0.7.0+build-1', '0.7.0+build-2')).toBe(0)
  })
})

describe('checkForUpdate', () => {
  it('缓存无法写入时仍然显示新版本', async () => {
    vi.stubGlobal('fetch', release('v9.9.9'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect((await checkForUpdate())?.hasUpdate).toBe(true)
  })

  it.each(['not-a-version', 'v1.2', 'v1.2.3-01', 'v01.2.3'])('忽略无效版本 %s', async (tag) => {
    vi.stubGlobal('fetch', release(tag))
    await expect(checkForUpdate()).resolves.toBeNull()
    expect(localStorage.getItem('snotes_update_check')).toBeNull()
  })

  it('忽略损坏缓存和不属于项目的发布链接', async () => {
    localStorage.setItem('snotes_update_check', '{')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'javascript:alert(1)' }))))
    expect((await checkForUpdate())?.url).toBe('https://github.com/xilele777/snotes/releases')
  })

  it('请求超时会取消并静默结束', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      signal = options.signal as AbortSignal
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const pending = checkForUpdate()
    await vi.advanceTimersByTimeAsync(8000)
    await expect(pending).resolves.toBeNull()
    expect(signal?.aborted).toBe(true)
  })

  it('线上版本更新时标记 hasUpdate 并缓存结果', async () => {
    const fetchMock = release(`v${bump(appVersion)}`)
    vi.stubGlobal('fetch', fetchMock)

    const info = await checkForUpdate()
    expect(info).toEqual({ latest: bump(appVersion), url: expect.stringContaining('/releases/tag/'), hasUpdate: true })
    expect(updateInfo.value).toEqual(info)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 一天内再查直接用缓存，不再请求 GitHub
    await checkForUpdate()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-09-17T09:00:00Z'))
    await checkForUpdate()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('版本一致时 hasUpdate 为 false', async () => {
    vi.stubGlobal('fetch', release(`v${appVersion}`))
    const info = await checkForUpdate()
    expect(info?.hasUpdate).toBe(false)
  })

  it('force 跳过缓存', async () => {
    const fetchMock = release(`v${appVersion}`)
    vi.stubGlobal('fetch', fetchMock)
    await checkForUpdate()
    await checkForUpdate({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('请求失败时静默返回 null，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    await expect(checkForUpdate()).resolves.toBeNull()
    expect(updateInfo.value).toBeNull()

    vi.stubGlobal('fetch', release('v9.9.9', 503))
    await expect(checkForUpdate({ force: true })).resolves.toBeNull()
  })

  it('请求失败但有过期缓存时回退到缓存', async () => {
    vi.stubGlobal('fetch', release(`v${bump(appVersion)}`))
    await checkForUpdate()
    vi.setSystemTime(new Date('2026-09-20T09:00:00Z'))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))

    const info = await checkForUpdate()
    expect(info?.hasUpdate).toBe(true)
  })

  it('离线时不发请求', async () => {
    const fetchMock = release('v9.9.9')
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await expect(checkForUpdate()).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
