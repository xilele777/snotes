import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/schema'
import { useNotesStore } from '../stores/notes'
import HistoryDialog from './HistoryDialog.vue'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  document.body.innerHTML = ''
})
afterEach(() => { document.body.innerHTML = '' })

async function noteWithHistory() {
  const notes = useNotesStore()
  const note = await notes.create()
  await notes.saveBody(note.id, '# 第一版')
  await notes.saveBody(note.id, '# 第二版')
  return { notes, note: notes.notes.find(n => n.id === note.id)! }
}

describe('HistoryDialog', () => {
  it('列出快照并可展开预览，点恢复上抛那一版正文', async () => {
    const { note } = await noteWithHistory()
    const wrapper = mount(HistoryDialog, { props: { open: true, note }, attachTo: document.body })
    await flushPromises()

    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="历史版本"]')!
    expect(dialog.textContent).toContain('1 条')
    expect(dialog.textContent).toContain('本机与云端')
    const items = document.querySelectorAll('.history-item')
    expect(items).toHaveLength(1)
    ;(items[0]!.querySelector('button[aria-expanded]') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('.history-preview')!.textContent).toBe('# 第一版')

    ;(document.querySelector('[data-op="restore"]') as HTMLButtonElement).click()
    const restored = wrapper.emitted('restore')!
    expect(restored).toHaveLength(1)
    expect(restored[0]![0]).toBe('# 第一版')
    wrapper.unmount()
  })

  it('没有快照时显示空态', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    const wrapper = mount(HistoryDialog, { props: { open: true, note: notes.notes.find(n => n.id === note.id) }, attachTo: document.body })
    await flushPromises()
    expect(document.querySelector('.history-empty')!.textContent).toContain('暂无历史版本')
    wrapper.unmount()
  })

  it('只读态没有恢复按钮', async () => {
    const { note } = await noteWithHistory()
    const wrapper = mount(HistoryDialog, { props: { open: true, note, readonly: true }, attachTo: document.body })
    await flushPromises()
    expect(document.querySelectorAll('.history-item')).toHaveLength(1)
    expect(document.querySelector('[data-op="restore"]')).toBeNull()
    wrapper.unmount()
  })

  it('关闭按钮与 Esc 都 emit close；关闭态不渲染', async () => {
    const { note } = await noteWithHistory()
    const wrapper = mount(HistoryDialog, { props: { open: true, note }, attachTo: document.body })
    await flushPromises()
    document.querySelector<HTMLButtonElement>('.history-dialog .dialog-btn.ok')!.click()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(2)
    await wrapper.setProps({ open: false })
    expect(document.querySelector('.history-dialog')).toBeNull()
    wrapper.unmount()
  })
})
