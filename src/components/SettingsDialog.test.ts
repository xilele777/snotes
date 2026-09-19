import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import SettingsDialog from './SettingsDialog.vue'
import { resetSettingsForTest, settings } from '../settings'

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  resetSettingsForTest()
})

const dialog = () => document.querySelector<HTMLElement>('.settings-dialog')
const radio = (setting: string, value: string) =>
  document.querySelector<HTMLButtonElement>(`[data-setting="${setting}"] [data-value="${value}"]`)

describe('SettingsDialog', () => {
  it('打开后显示三组选项，当前值处于选中态', async () => {
    mount(SettingsDialog, { props: { open: true } })
    await nextTick()

    expect(dialog()).not.toBeNull()
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
    expect(radio('theme', 'system')!.getAttribute('aria-checked')).toBe('true')
    expect(radio('fontSize', 'medium')!.getAttribute('aria-checked')).toBe('true')
    expect(radio('editorWidth', 'medium')!.getAttribute('aria-checked')).toBe('true')
  })

  it('点选项立即改设置，不需要额外保存', async () => {
    mount(SettingsDialog, { props: { open: true } })
    await nextTick()

    radio('theme', 'dark')!.click()
    radio('fontSize', 'large')!.click()
    radio('editorWidth', 'wide')!.click()
    await nextTick()

    expect(settings.value).toEqual({ theme: 'dark', fontSize: 'large', editorWidth: 'wide' })
    expect(radio('theme', 'dark')!.getAttribute('aria-checked')).toBe('true')
    expect(radio('theme', 'system')!.getAttribute('aria-checked')).toBe('false')
  })

  it('点完成与 Esc 都会关闭', async () => {
    const wrapper = mount(SettingsDialog, { props: { open: true } })
    await nextTick()

    dialog()!.querySelector<HTMLButtonElement>('.dialog-btn.ok')!.click()
    expect(wrapper.emitted('close')).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('关闭态不渲染任何内容', () => {
    mount(SettingsDialog, { props: { open: false } })
    expect(dialog()).toBeNull()
  })
})
