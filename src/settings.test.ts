import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, THEME_COLORS, applySettings, initSettings, parseSettings,
  resetSettingsForTest, resolveTheme, settings, updateSettings,
} from './settings'

function stubMedia(dark: boolean) {
  const listeners: Array<() => void> = []
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark') ? dark : false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_: string, cb: () => void) => { listeners.push(cb) },
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  return { fire: () => listeners.forEach((cb) => cb()) }
}

beforeEach(() => {
  localStorage.clear()
  resetSettingsForTest()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.fontSize
  delete document.documentElement.dataset.editorWidth
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">'
  stubMedia(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseSettings', () => {
  it('缺省、坏 JSON、非法取值都回到默认', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{"theme":"neon","fontSize":"huge","editorWidth":5}')).toEqual(DEFAULT_SETTINGS)
  })

  it('合法取值原样保留，缺失字段补默认', () => {
    expect(parseSettings('{"theme":"dark"}')).toEqual({ theme: 'dark', fontSize: 'medium', editorWidth: 'medium' })
    expect(parseSettings('{"fontSize":"large","editorWidth":"wide"}')).toEqual({ theme: 'system', fontSize: 'large', editorWidth: 'wide' })
  })
})

describe('resolveTheme', () => {
  it('跟随系统时看 prefers-color-scheme，其余按设置', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('applySettings', () => {
  it('把主题、字号、宽度写到 <html> 并更新 theme-color', () => {
    applySettings({ theme: 'dark', fontSize: 'large', editorWidth: 'wide' })

    const root = document.documentElement
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.fontSize).toBe('large')
    expect(root.dataset.editorWidth).toBe('wide')
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe(THEME_COLORS.dark)
  })

  it('跟随系统且系统为深色时解析成 dark', () => {
    stubMedia(true)
    applySettings({ ...DEFAULT_SETTINGS, theme: 'system' })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('initSettings', () => {
  it('启动即应用，改动写回 localStorage', async () => {
    initSettings()
    expect(document.documentElement.dataset.theme).toBe('light')

    updateSettings({ theme: 'dark', fontSize: 'small' })
    await nextTick()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.fontSize).toBe('small')
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual({ theme: 'dark', fontSize: 'small', editorWidth: 'medium' })
  })

  it('跟随系统时系统切换深色会跟着变；手动选了浅色则不跟', () => {
    const media = stubMedia(false)
    initSettings()
    expect(document.documentElement.dataset.theme).toBe('light')

    // 模拟系统切到深色
    stubMedia(true)
    media.fire()
    expect(document.documentElement.dataset.theme).toBe('dark')

    settings.value = { ...settings.value, theme: 'light' }
    applySettings()
    media.fire()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('localStorage 写不了时设置仍然生效', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    initSettings()
    updateSettings({ editorWidth: 'narrow' })
    await nextTick()
    expect(document.documentElement.dataset.editorWidth).toBe('narrow')
  })
})
