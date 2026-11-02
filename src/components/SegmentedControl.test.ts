import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { expect, it } from 'vitest'
import SegmentedControl from './SegmentedControl.vue'

it('单个 Tab 入口，方向键循环切换并同步焦点，Home/End 到两端', async () => {
  const Host = defineComponent({
    setup() {
      const value = ref('light')
      return () => h(SegmentedControl, {
        modelValue: value.value, labelledby: 'theme-label',
        options: [{ value: 'system', label: '系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }],
        'onUpdate:modelValue': (next: string) => { value.value = next },
      })
    },
  })
  const wrapper = mount(Host, { attachTo: document.body })
  try {
    for (const [key, expected] of [['ArrowRight', 'dark'], ['ArrowDown', 'system'], ['ArrowLeft', 'dark'], ['Home', 'system'], ['End', 'dark']]) {
      await wrapper.get('[aria-checked="true"]').trigger('keydown', { key })
      expect(wrapper.get('[aria-checked="true"]').attributes('data-value')).toBe(expected)
      expect(document.activeElement).toBe(wrapper.get(`[data-value="${expected}"]`).element)
      expect(wrapper.findAll('[tabindex="0"]')).toHaveLength(1)
    }
    await wrapper.get('[data-value="light"]').trigger('click')
    expect(wrapper.get('[tabindex="0"]').attributes('data-value')).toBe('light')
  } finally { wrapper.unmount() }
})
