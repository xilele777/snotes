import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
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

  it('列表区 header 显示视图标题，不再有 logo 字样', async () => {
    const store = useNotesStore()
    await store.create()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.list-header .header-title').text()).toBe('全部笔记')
    expect(wrapper.find('.list-header .header-name').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('snotes')
  })

  it('新建按钮在列表顶栏且能建笔记', async () => {
    const store = useNotesStore()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    const create = wrapper.find('.list-header .header-create')
    expect(create.exists()).toBe(true)
    expect(create.attributes('aria-label')).toBe('新建笔记')

    await create.trigger('click')
    await vi.waitFor(() => {
      expect(store.notes.length).toBe(1)
    })
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

  it('点击展开的删除按钮先确认再移入回收站', async () => {
    const store = useNotesStore()
    const note = await store.create()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    const item = wrapper.find('.note-item')
    pointer(item.element, 'pointerdown', 100)
    pointer(item.element, 'pointerup', 50)
    await wrapper.find('.note-item .delete').trigger('click')

    // 未确认前数据不动
    expect(wrapper.find('.confirm-dialog').exists()).toBe(true)
    await wrapper.find('[data-op="confirm"]').trigger('click')

    await vi.waitFor(() => {
      expect((store.notes.find((n) => n.id === note.id)) == null).toBe(true)
    })
    expect((await db.notes.get(note.id))!.invalid).toBe(1)
  })

  it('删除确认弹窗可取消且不删笔记', async () => {
    const store = useNotesStore()
    const note = await store.create()

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    const item = wrapper.find('.note-item')
    pointer(item.element, 'pointerdown', 100)
    pointer(item.element, 'pointerup', 50)
    await wrapper.find('.note-item .delete').trigger('click')
    await wrapper.find('[data-op="cancel"]').trigger('click')

    expect(wrapper.find('.confirm-dialog').exists()).toBe(false)
    expect(store.notes.find((n) => n.id === note.id)).toBeDefined()
  })

  it('列表为空时显示空态', async () => {
    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('还没有笔记')
    expect(wrapper.find('.empty-state .empty-action').text()).toBe('新建笔记')
  })

  it('星标视图空态不引导新建——星标是标出来的，不是建出来的', async () => {
    const ui = useUiStore()
    ui.view = 'star'

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('没有星标笔记')
    expect(wrapper.find('.empty-state .empty-action').exists()).toBe(false)
  })

  it('搜索无结果时空态给的是清除搜索而不是新建', async () => {
    const store = useNotesStore()
    const note = await store.create()
    await store.saveBody(note.id, '会议纪要')

    const ui = useUiStore()
    ui.query = '不存在的词'

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('没有匹配「不存在的词」的笔记')

    await wrapper.find('.empty-state .empty-action').trigger('click')
    expect(ui.query).toBe('')
  })

  // 行高一致的结构前提：摘要块必须常驻，缺了它日期行会整体上移
  it('只有标题的笔记摘要为空，但摘要块与日期行照样在', async () => {
    const store = useNotesStore()
    const note = await store.create()
    await store.saveBody(note.id, '只有标题')

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    const item = wrapper.find('.note-item')
    expect(item.find('.note-title').text()).toBe('只有标题')
    // 摘要不再复读标题
    expect(item.find('.note-summary').exists()).toBe(true)
    expect(item.find('.note-summary').text()).toBe('')
    expect(item.find('.note-meta').exists()).toBe(true)
  })

  it('多行笔记的摘要从标题的下一行起算', async () => {
    const store = useNotesStore()
    const note = await store.create()
    await store.saveBody(note.id, '# 周会纪要\n讨论了排期')

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    const item = wrapper.find('.note-item')
    expect(item.find('.note-title').text()).toBe('周会纪要')
    expect(item.find('.note-summary').text()).toBe('讨论了排期')
  })

  it('以图片开头的笔记标题不再是一串 base64', async () => {
    const store = useNotesStore()
    const note = await store.create()
    const dataUri = `data:image/png;base64,${'iVBORw0KGgo'.repeat(20)}`
    await store.saveBody(note.id, `![](${dataUri})\n\n白板照片`)

    const wrapper = mount(NoteList)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.note-item .note-title').text()).toBe('白板照片')
    expect(wrapper.text()).not.toContain('base64')
  })
})
