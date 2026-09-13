import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('聚焦取消按钮、限制 Tab 焦点，Esc 关闭后恢复原焦点', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const wrapper = mount(ConfirmDialog, {
      props: { open: false, title: '删除？' },
      attachTo: document.body,
    })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('[data-op="cancel"]').element)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }))
    expect(document.activeElement).toBe(wrapper.get('[data-op="confirm"]').element)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
    trigger.remove()
  })

  it('open=false 时不渲染任何东西', () => {
    const wrapper = mount(ConfirmDialog, { props: { open: false, title: '删除？' } })

    expect(wrapper.find('.dialog-mask').exists()).toBe(false)
    expect(wrapper.find('[data-op="confirm"]').exists()).toBe(false)
  })

  it('渲染标题、说明与确认钮文案', () => {
    const wrapper = mount(ConfirmDialog, {
      props: {
        open: true,
        title: '删除这条笔记？',
        message: '笔记会移入回收站，可随时恢复。',
        confirmText: '删除',
      },
    })

    expect(wrapper.find('.dialog-title').text()).toBe('删除这条笔记？')
    expect(wrapper.find('.confirm-message').text()).toBe('笔记会移入回收站，可随时恢复。')
    expect(wrapper.find('[data-op="confirm"]').text()).toBe('删除')
    expect(wrapper.find('[data-op="cancel"]').text()).toBe('取消')
  })

  it('没有 message 时不渲染说明行', () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '删除？' } })

    expect(wrapper.find('.confirm-message').exists()).toBe(false)
  })

  it('点确认发 confirm', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '删除？' } })

    await wrapper.find('[data-op="confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('点取消发 cancel', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '删除？' } })

    await wrapper.find('[data-op="cancel"]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
