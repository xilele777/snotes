import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import NoteSearch from './NoteSearch.vue'
import { useUiStore } from '../stores/ui'

beforeEach(() => setActivePinia(createPinia()))

describe('NoteSearch', () => {
  it('输入法选词时，回车与方向键不会打开笔记', async () => {
    const wrapper = mount(NoteSearch)
    const input = wrapper.get('input')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    await input.trigger('keydown', { key: 'ArrowDown', isComposing: true })
    expect(wrapper.emitted('first')).toBeUndefined()

    await input.trigger('keydown', { key: 'Enter', isComposing: false })
    expect(wrapper.emitted('first')).toHaveLength(1)
    wrapper.unmount()
  })

  it('清除搜索后仍可直接输入下一次查询', async () => {
    const ui = useUiStore()
    ui.query = '想法'
    const wrapper = mount(NoteSearch, { attachTo: document.body })
    await wrapper.get('[aria-label="清除搜索"]').trigger('click')
    expect(ui.query).toBe('')
    expect(document.activeElement).toBe(wrapper.get('input').element)
    wrapper.unmount()
  })
})
