import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { useNotesStore } from '../stores/notes'
import NoteList from './NoteList.vue'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

/**
 * 派发带 clientX 的 PointerEvent。
 * 不能用 `wrapper.trigger('pointerdown', { clientX })`：jsdom 29 下 clientX 是
 * MouseEvent/PointerEvent 原型上的只读 getter，@vue/test-utils 的 createDOMEvent
 * 检测到无 setter 后会跳过赋值，导致 clientX 永远为 0。直接构造 PointerEvent 把
 * clientX 传进 init 即可（详见 Task 16 实现偏离记录）。
 */
function pointer(el: Element, type: string, clientX: number) {
  el.dispatchEvent(new PointerEvent(type, { clientX, bubbles: true }))
}

describe('NoteList', () => {
  it('渲染标题与摘要', async () => {
    const store = useNotesStore()
    const note = await store.create()
    await store.saveBody(note.id, '# 我的标题\n我的摘要')

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('我的标题')
    expect(wrapper.text()).toContain('我的摘要')
  })

  it('列表区 header 显示 logo 名与视图标题', async () => {
    const store = useNotesStore()
    await store.create()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.list-header .header-name').text()).toBe('snotes')
    expect(wrapper.find('.list-header .header-title').text()).toBe('全部笔记')
  })

  it('无标题时显示占位文案', async () => {
    const store = useNotesStore()
    await store.create()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('无标题')
  })

  it('置顶笔记带 is-top 标记且底部渲染置顶图标', async () => {
    const store = useNotesStore()
    const note = await store.create()
    await store.setProps(note.id, { top: 1 })

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.note-item.is-top').exists()).toBe(true)
    // 置顶图标常驻底部日期行（对照原站 note_list_item_date 里的图钉）
    expect(wrapper.find('.note-item .note-pin').exists()).toBe(true)
  })

  it('星标笔记底部常驻星标图标', async () => {
    const store = useNotesStore()
    const note = await store.create()
    await store.setProps(note.id, { star: 1 })

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.note-item .note-star').exists()).toBe(true)
  })

  it('未置顶/未星标时不渲染标记图标', async () => {
    const store = useNotesStore()
    await store.create()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.note-item .note-pin').exists()).toBe(false)
    expect(wrapper.find('.note-item .note-star').exists()).toBe(false)
  })

  it('有缩略图时渲染 img 且 src 为同源路径', async () => {
    const store = useNotesStore()
    const note = await store.create()
    await store.saveBody(note.id, '标题\n![](/api/images/n/k.png)')

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    const img = wrapper.find('.note-item img.thumb')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/api/images/n/k.png')
  })

  it('选中态色条取该笔记自身皮肤色', async () => {
    const store = useNotesStore()
    const note = await store.create()
    store.currentId = note.id
    // 皮肤色入口已移到编辑器顶栏更多菜单，列表只负责渲染，直接经 store 写入
    await store.setProps(note.id, { skin_color: '#fed634' })

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    // 选中态色条颜色通过 --skin 变量下发给 CSS（UI 规格 §3.5）
    expect(wrapper.find('.note-item.is-active').attributes('style')).toContain('--skin')
  })

  it('点击条目切换当前笔记', async () => {
    const store = useNotesStore()
    const a = await store.create()
    const b = await store.create()
    // 两条笔记很可能落在同一毫秒，必须显式拉开时间，否则「第一项是谁」不确定
    await db.notes.update(a.id, { update_time: 1000 })
    await db.notes.update(b.id, { update_time: 2000 })
    await store.load()
    store.currentId = a.id

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.note-item')[0].trigger('click')

    expect(store.currentId).toBe(b.id)
  })

  it('左滑超过阈值展开删除按钮', async () => {
    const store = useNotesStore()
    await store.create()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    const item = wrapper.find('.note-item')
    pointer(item.element, 'pointerdown', 100)
    pointer(item.element, 'pointerup', 50) // delta = -50 < -40
    await wrapper.vm.$nextTick()

    expect(item.classes()).toContain('swiped')
    expect(wrapper.find('.note-item .delete').exists()).toBe(true)
  })

  it('点击展开的删除按钮移入回收站', async () => {
    const store = useNotesStore()
    const note = await store.create()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    const item = wrapper.find('.note-item')
    pointer(item.element, 'pointerdown', 100)
    pointer(item.element, 'pointerup', 50)
    await wrapper.find('.note-item .delete').trigger('click')

    await vi.waitFor(() => {
      expect((store.notes.find((n) => n.id === note.id)) == null).toBe(true)
    })
    expect((await db.notes.get(note.id))!.invalid).toBe(1)
  })

  it('列表为空时显示空态', async () => {
    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('还没有笔记')
  })
})
