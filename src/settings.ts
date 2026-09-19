import { ref, watch } from 'vue'

/** 主题、字号、编辑区宽度只影响本设备，存 localStorage，不进同步。 */
export type Theme = 'system' | 'light' | 'dark'
export type FontSize = 'small' | 'medium' | 'large'
export type EditorWidth = 'narrow' | 'medium' | 'wide'

export interface Settings {
  theme: Theme
  fontSize: FontSize
  editorWidth: EditorWidth
}

/** index.html 里的首帧脚本读的是同一个键，改名时两处一起改。 */
export const SETTINGS_KEY = 'snotes_settings'

export const DEFAULT_SETTINGS: Settings = { theme: 'system', fontSize: 'medium', editorWidth: 'medium' }

/** 地址栏与系统状态栏的底色，随主题切换；与 styles.css 的 --bg-surface 保持一致。 */
export const THEME_COLORS: Record<'light' | 'dark', string> = { light: '#ffffff', dark: '#232428' }

const THEMES: readonly Theme[] = ['system', 'light', 'dark']
const FONT_SIZES: readonly FontSize[] = ['small', 'medium', 'large']
const EDITOR_WIDTHS: readonly EditorWidth[] = ['narrow', 'medium', 'wide']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** 读坏了的 JSON 或缺字段都回到默认值，不让一条脏数据把设置页搞挂。 */
export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>> | null
    return {
      theme: pick(data?.theme, THEMES, DEFAULT_SETTINGS.theme),
      fontSize: pick(data?.fontSize, FONT_SIZES, DEFAULT_SETTINGS.fontSize),
      editorWidth: pick(data?.editorWidth, EDITOR_WIDTHS, DEFAULT_SETTINGS.editorWidth),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

function readStorage(): string | null {
  try { return localStorage.getItem(SETTINGS_KEY) } catch { return null }
}

export const settings = ref<Settings>(parseSettings(typeof localStorage === 'undefined' ? null : readStorage()))

function systemDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 把设置落到 <html> 的 data 属性上，CSS 只认这三个属性；主题存的是解析后的浅/深色。 */
export function applySettings(current: Settings = settings.value): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(current.theme, systemDark())
  root.dataset.fontSize = current.fontSize
  root.dataset.editorWidth = current.editorWidth
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLORS[root.dataset.theme as 'light' | 'dark']
}

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch }
}

let started = false

/** 应用启动时调用一次：应用当前设置、写回变更、跟随系统主题的变化。 */
export function initSettings(): void {
  if (started) return
  started = true
  applySettings()
  watch(settings, (value) => {
    applySettings(value)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)) } catch { /* 隐私模式下存不了也照常生效 */ }
  }, { deep: true })
  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener?.('change', () => { if (settings.value.theme === 'system') applySettings() })
  }
}

/** 仅供测试重置模块状态 */
export function resetSettingsForTest(): void {
  started = false
  settings.value = { ...DEFAULT_SETTINGS }
}
