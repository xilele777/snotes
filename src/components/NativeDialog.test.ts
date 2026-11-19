import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NativeDialog from './NativeDialog.vue'

describe('NativeDialog', () => {
  it('does not report a parent-controlled close as a second dismissal', async () => {
    const wrapper = mount(NativeDialog, { props: { open: true }, slots: { default: '<button>Close</button>' } })
    await nextTick()
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(true)
    await wrapper.setProps({ open: false })
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ open: true })
    ;(wrapper.get('dialog').element as HTMLDialogElement).close()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('blocks platform dismissal only while a destructive operation is pending', async () => {
    const wrapper = mount(NativeDialog, { props: { open: true, dismissible: false } })
    const cancel = new Event('cancel', { cancelable: true })
    wrapper.get('dialog').element.dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(wrapper.get('dialog').attributes('closedby')).toBe('none')
    await wrapper.setProps({ dismissible: true })
    const allowed = new Event('cancel', { cancelable: true })
    wrapper.get('dialog').element.dispatchEvent(allowed)
    expect(allowed.defaultPrevented).toBe(true)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
