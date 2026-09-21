import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog.vue'
import { resetSettingsForTest, settings } from '../settings'
import { useUiStore } from '../stores/ui'
import { updateInfo } from '../update-check'

const clearToken = vi.hoisted(() => vi.fn())
vi.mock('../api/token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/token')>()),
  clearToken,
}))
const buildBackup = vi.hoisted(() => vi.fn())
vi.mock('../export/backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export/backup')>()),
  buildBackup,
}))
const downloadBlob = vi.hoisted(() => vi.fn())
vi.mock('../export/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export/share')>()),
  downloadBlob,
}))

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  localStorage.clear()
  resetSettingsForTest()
  updateInfo.value = null
  clearToken.mockReset()
  buildBackup.mockReset()
  downloadBlob.mockReset()
  window.history.replaceState(null, '')
})
afterEach(() => { document.body.innerHTML = '' })

const dialog = () => document.querySelector<HTMLElement>('.settings-dialog')
const tab = (id: string) => document.querySelector<HTMLButtonElement>(`.settings-tab[data-tab="${id}"]`)
const radio = (setting: string, value: string) =>
  document.querySelector<HTMLButtonElement>(`[data-setting="${setting}"] [data-value="${value}"]`)

/** 弹窗的开合走 ui.overlay；这里直接摆 store 状态，不经过 navigation 的历史栈 */
async function mountOpen(tabId: 'appearance' | 'data' | 'shortcuts' | 'about' = 'appearance') {
  const ui = useUiStore()
  ui.overlay = 'settings'
  ui.settingsTab = tabId
  const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
  await nextTick()
  return { ui, wrapper }
}

describe('SettingsDialog 分页壳', () => {
  it('四个分页按顺序渲染，默认停在外观，当前值处于选中态', async () => {
    const { wrapper } = await mountOpen()

    expect(dialog()).not.toBeNull()
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
    expect(Array.from(document.querySelectorAll('.settings-tab')).map(el => el.textContent)).toEqual(['外观', '数据', '快捷键', '关于'])
    expect(tab('appearance')!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('appearance'))
    expect(radio('theme', 'system')!.getAttribute('aria-checked')).toBe('true')
    expect(radio('fontSize', 'medium')!.getAttribute('aria-checked')).toBe('true')
    expect(radio('editorWidth', 'medium')!.getAttribute('aria-checked')).toBe('true')
    expect(radio('tableDensity', 'medium')!.getAttribute('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('点选项立即改设置，不需要额外保存', async () => {
    const { wrapper } = await mountOpen()

    radio('theme', 'dark')!.click()
    radio('fontSize', 'large')!.click()
    radio('editorWidth', 'wide')!.click()
    radio('tableDensity', 'compact')!.click()
    await nextTick()

    expect(settings.value).toEqual({ theme: 'dark', fontSize: 'large', editorWidth: 'wide', tableDensity: 'compact' })
    expect(radio('theme', 'dark')!.getAttribute('aria-checked')).toBe('true')
    expect(radio('theme', 'system')!.getAttribute('aria-checked')).toBe('false')
    wrapper.unmount()
  })

  it('点分页与方向键都能切换，分页状态存在 store 里', async () => {
    const { ui, wrapper } = await mountOpen()

    tab('data')!.click()
    await nextTick()
    expect(ui.settingsTab).toBe('data')
    expect(tab('data')!.getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('[data-action="export"]')).not.toBeNull()

    tab('data')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(ui.settingsTab).toBe('shortcuts')
    expect(document.activeElement).toBe(tab('shortcuts'))

    tab('shortcuts')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    tab('about')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    // 末尾再往右回到开头
    expect(ui.settingsTab).toBe('appearance')
    wrapper.unmount()
  })

  it('按指定分页打开时直接落在那一页', async () => {
    const { wrapper } = await mountOpen('about')
    expect(tab('about')!.getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('.settings-pane')!.textContent).toContain('网页版本')
    wrapper.unmount()
  })

  it('关闭按钮、Esc 与遮罩都清掉 overlay', async () => {
    const { ui, wrapper } = await mountOpen()

    dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭设置"]')!.click()
    expect(ui.overlay).toBeNull()

    ui.overlay = 'settings'
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(ui.overlay).toBeNull()

    ui.overlay = 'settings'
    await nextTick()
    document.querySelector<HTMLElement>('.settings-mask')!.click()
    expect(ui.overlay).toBeNull()
    wrapper.unmount()
  })

  it('关闭态不渲染任何内容', () => {
    mount(SettingsDialog, { props: { open: false } })
    expect(dialog()).toBeNull()
  })
})

describe('SettingsDialog 快捷键页', () => {
  it('列出全局快捷键（含 Mod ,）、编辑器快捷键与 Markdown 速查', async () => {
    const { wrapper } = await mountOpen('shortcuts')
    const text = document.querySelector('.settings-pane')!.textContent!
    expect(text).toContain('新建笔记')
    expect(text).toContain('打开设置')
    expect(text).toContain('Ctrl ,')
    expect(text).toContain('撤销')
    expect(text).toContain('# 空格')
    wrapper.unmount()
  })
})

describe('SettingsDialog 数据页', () => {
  it('导出全部：调用 buildBackup 并下载，成功后给出结果文案', async () => {
    buildBackup.mockResolvedValue({ blob: new Blob(['zip']), notes: 3, groups: 1, images: 2, missingImages: 0 })
    const { wrapper } = await mountOpen('data')

    document.querySelector<HTMLButtonElement>('[data-action="export"]')!.click()
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(String(downloadBlob.mock.calls[0]![1])).toMatch(/^snotes-backup-\d{8}\.zip$/)
    await vi.waitFor(() => expect(document.querySelector('.backup-progress')!.textContent).toContain('已导出 3 条笔记、1 个分组、2 张图片'))
    expect(document.querySelector('.backup-progress')!.classList.contains('failed')).toBe(false)
    wrapper.unmount()
  })

  it('有图片下载失败时标成失败并说明数量', async () => {
    buildBackup.mockResolvedValue({ blob: new Blob(['zip']), notes: 1, groups: 0, images: 1, missingImages: 1 })
    const { wrapper } = await mountOpen('data')

    document.querySelector<HTMLButtonElement>('[data-action="export"]')!.click()
    await vi.waitFor(() => expect(document.querySelector('.backup-progress')!.textContent).toContain('1 张图片下载失败'))
    expect(document.querySelector('.backup-progress')!.classList.contains('failed')).toBe(true)
    wrapper.unmount()
  })

  it('导入按钮打开文件选择器', async () => {
    const { wrapper } = await mountOpen('data')
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const click = vi.spyOn(input, 'click')
    document.querySelector<HTMLButtonElement>('[data-action="import"]')!.click()
    expect(click).toHaveBeenCalledTimes(1)
    expect(input.accept).toContain('.zip')
    wrapper.unmount()
  })
})

describe('SettingsDialog 关于页', () => {
  it('显示当前版本；没有新版本时链接指向全部版本', async () => {
    const { wrapper } = await mountOpen('about')
    const pane = document.querySelector('.settings-pane')!
    expect(pane.textContent).toContain('网页版本')
    const link = pane.querySelector<HTMLAnchorElement>('a')!
    expect(link.textContent).toBe('查看全部版本')
    expect(link.href).toBe('https://github.com/xilele777/snotes/releases')
    expect(link.target).toBe('_blank')
    wrapper.unmount()
  })

  it('有新版本时「关于」分页带蓝点，页内给出升级命令与发布说明链接', async () => {
    updateInfo.value = { latest: '9.9.9', url: 'https://github.com/xilele777/snotes/releases/tag/v9.9.9', hasUpdate: true }
    const { wrapper } = await mountOpen('about')
    expect(tab('about')!.classList.contains('has-update')).toBe(true)
    const pane = document.querySelector('.settings-pane')!
    expect(pane.textContent).toContain('v9.9.9')
    expect(pane.textContent).toContain('npm run deploy')
    const link = pane.querySelector<HTMLAnchorElement>('a')!
    expect(link.textContent).toBe('查看发布说明')
    expect(link.href).toBe('https://github.com/xilele777/snotes/releases/tag/v9.9.9')
    wrapper.unmount()
  })

  it('退出登录先确认；确认后关闭设置并只清令牌', async () => {
    const { ui, wrapper } = await mountOpen('about')

    document.querySelector<HTMLButtonElement>('[data-action="logout"]')!.click()
    await nextTick()
    const confirm = document.querySelector<HTMLElement>('.confirm-dialog')!
    expect(confirm.textContent).toContain('退出登录？')
    expect(confirm.textContent).toContain('本机已同步的笔记会保留')
    expect(clearToken).not.toHaveBeenCalled()

    // 两层弹窗同时开着时 Esc 只关最上面的确认框
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.querySelector('.confirm-dialog')).toBeNull()
    expect(ui.overlay).toBe('settings')

    document.querySelector<HTMLButtonElement>('[data-action="logout"]')!.click()
    await nextTick()
    document.querySelector<HTMLButtonElement>('.confirm-dialog [data-op="confirm"]')!.click()
    await nextTick()

    expect(clearToken).toHaveBeenCalledTimes(1)
    expect(ui.overlay).toBeNull()
    wrapper.unmount()
  })
})
