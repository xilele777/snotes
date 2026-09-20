import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ActionMenu from './ActionMenu.vue'

beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { document.body.innerHTML = '' })

/** 一颗触发按钮 + 三个条目的最小宿主，与 GroupMenu / NoteMenu 的用法一致 */
const Host = defineComponent({
  props: { disableSecond: { type: Boolean, default: false } },
  setup(props) {
    const open = ref(false)
    const anchor = ref<HTMLElement | null>(null)
    return () => [
      h('button', { ref: anchor, class: 'trigger', onClick: () => { open.value = !open.value } }, '打开'),
      h('button', { class: 'outside' }, '外面'),
      h(ActionMenu, { open: open.value, anchor: anchor.value, label: '测试菜单', menuClass: 'test-menu', onClose: () => { open.value = false } }, () => [
        h('button', { role: 'menuitem', class: 'menu-item', 'data-action': 'a' }, '甲'),
        h('button', { role: 'menuitem', class: 'menu-item', 'data-action': 'b', disabled: props.disableSecond }, '乙'),
        h('button', { role: 'menuitem', class: 'menu-item', 'data-action': 'c' }, '丙'),
      ]),
    ]
  },
})

const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
const item = (name: string) => document.querySelector<HTMLButtonElement>(`[role="menu"] [data-action="${name}"]`)

async function openMenu(wrapper: ReturnType<typeof mount>) {
  const trigger = wrapper.get<HTMLButtonElement>('.trigger')
  trigger.element.focus()
  await trigger.trigger('click')
  await nextTick()
  return trigger
}

describe('ActionMenu', () => {
  it('打开后 Teleport 到 body，带 aria-label 与自定义类名，首个条目获得焦点', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    expect(menu()).toBeNull()
    await openMenu(wrapper)

    expect(menu()).not.toBeNull()
    expect(menu()!.parentElement).toBe(document.body)
    expect(menu()!.getAttribute('aria-label')).toBe('测试菜单')
    expect(menu()!.classList.contains('action-menu')).toBe(true)
    expect(menu()!.classList.contains('test-menu')).toBe(true)
    expect(document.activeElement).toBe(item('a'))
    wrapper.unmount()
  })

  it('方向键在可用条目间循环，跳过禁用项', async () => {
    const wrapper = mount(Host, { props: { disableSecond: true }, attachTo: document.body })
    await openMenu(wrapper)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(item('c'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(item('a'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(item('c'))
    wrapper.unmount()
  })

  it('Esc 与 Tab 关闭并把焦点还给触发按钮，事件不再外传', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const trigger = await openMenu(wrapper)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(escape)
    await nextTick()
    expect(escape.defaultPrevented).toBe(true)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger.element)

    await openMenu(wrapper)
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    window.dispatchEvent(tab)
    await nextTick()
    expect(tab.defaultPrevented).toBe(true)
    expect(menu()).toBeNull()
    wrapper.unmount()
  })

  it('点菜单外部关闭；点触发按钮由宿主切换开关', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const trigger = await openMenu(wrapper)

    wrapper.get('.outside').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(menu()).toBeNull()

    await trigger.trigger('click')
    await nextTick()
    expect(menu()).not.toBeNull()
    await trigger.trigger('click')
    await nextTick()
    expect(menu()).toBeNull()
    wrapper.unmount()
  })

  it('底部放不下时翻到锚点上方，左侧不会超出视口', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const trigger = wrapper.get<HTMLButtonElement>('.trigger').element
    // jsdom 没有布局：手工给锚点和菜单一个尺寸
    trigger.getBoundingClientRect = () => ({ top: 700, bottom: 730, left: 10, right: 40, width: 30, height: 30, x: 10, y: 700, toJSON: () => ({}) })
    await openMenu(wrapper)
    Object.defineProperty(menu()!, 'offsetHeight', { value: 200, configurable: true })
    Object.defineProperty(menu()!, 'offsetWidth', { value: 180, configurable: true })
    window.dispatchEvent(new Event('resize'))
    await nextTick()

    const top = parseFloat(menu()!.style.top)
    const left = parseFloat(menu()!.style.left)
    expect(top).toBe(700 - 200 - 4)
    expect(left).toBe(8)
    wrapper.unmount()
  })
})
