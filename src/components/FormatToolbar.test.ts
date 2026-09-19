import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FormatToolbar from './FormatToolbar.vue'
import { EMPTY_FORMAT_STATE, type FormatState } from '../editor/format'

const mountBar = (state: Partial<FormatState> = {}) =>
  mount(FormatToolbar, { props: { state: { ...EMPTY_FORMAT_STATE, ...state } } })

describe('FormatToolbar', () => {
  it('标题三级加十一个格式按钮全部直接可见，不用先点开菜单', () => {
    const wrapper = mountBar()

    for (const action of ['heading1', 'heading2', 'heading3']) {
      expect(wrapper.find(`[data-format="${action}"]`).exists()).toBe(true)
    }
    for (const action of [
      'bold', 'italic', 'strike', 'inlineCode', 'bulletList', 'orderedList',
      'taskList', 'quote', 'codeBlock', 'link', 'table',
    ]) {
      expect(wrapper.find(`[data-format="${action}"]`).exists()).toBe(true)
    }
    // 每个按钮都得有可读名字，图标按钮只靠图形是认不出来的
    for (const button of wrapper.findAll('.format-btn')) {
      expect(button.attributes('aria-label')).toBeTruthy()
    }
  })

  it('光标处的格式点亮对应按钮', () => {
    const wrapper = mountBar({ bold: true, heading: 2, list: 'task', quote: true })

    expect(wrapper.find('[data-format="bold"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-format="heading2"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-format="taskList"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-format="quote"]').attributes('aria-pressed')).toBe('true')
    // 同组的其它按钮不该跟着亮
    expect(wrapper.find('[data-format="italic"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('[data-format="heading1"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('[data-format="orderedList"]').attributes('aria-pressed')).toBe('false')
  })

  it('点击按 data-format 抛出对应的动作', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-format="orderedList"]').trigger('click')
    await wrapper.find('[data-format="heading3"]').trigger('click')
    await wrapper.find('[data-format="link"]').trigger('click')
    await wrapper.find('[data-format="table"]').trigger('click')

    expect(wrapper.emitted('action')).toEqual([
      ['orderedList'], ['heading3'], ['link'], ['table'],
    ])
  })

  it('按下时拦掉 mousedown，避免点按钮把编辑器的选区丢掉', async () => {
    const wrapper = mountBar()
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    wrapper.find('.format-bar').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})
