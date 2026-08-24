import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db/schema'
import NoteDetail from './components/NoteDetail.vue'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import App from './App.vue'

// Milkdown 起真实 ProseMirror，单测里换成空壳
vi.mock('@milkdown/vue', () => ({
  Milkdown: { template: '<div class="milkdown-mock" />' },
  MilkdownProvider: { template: '<div><slot /></div>' },
  useEditor: () => ({ loading: { value: false }, get: () => undefined }),
}))
// 令牌态默认放行，进 layout 分支
vi.mock('./api/token', async () => {
  const { ref } = await import('vue')
  return { hasToken: ref(true) }
})

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

describe('App 侧栏抽屉', () => {
  it('默认收起，点 ☰ 展开并出遮罩', async () => {
    const ui = useUiStore()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.sidebar-pane').classes()).not.toContain('is-open')
    expect(wrapper.find('.drawer-mask').exists()).toBe(false)

    await wrapper.find('.drawer-btn').trigger('click')

    expect(ui.drawerOpen).toBe(true)
    expect(wrapper.find('.sidebar-pane').classes()).toContain('is-open')
    expect(wrapper.find('.drawer-mask').exists()).toBe(true)
    wrapper.unmount()
  })

  it('点遮罩收起抽屉', async () => {
    const ui = useUiStore()
    ui.drawerOpen = true

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.drawer-mask').trigger('click')

    expect(ui.drawerOpen).toBe(false)
    wrapper.unmount()
  })

  it('切换视图后自动收起抽屉', async () => {
    const ui = useUiStore()
    ui.drawerOpen = true

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-view="star"]').trigger('click')

    await vi.waitFor(() => {
      expect(ui.drawerOpen).toBe(false)
    })
    wrapper.unmount()
  })
})

describe('App 新建入口', () => {
  it('不再有右下角浮动新建按钮，入口只在列表顶栏', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.create-btn').exists()).toBe(false)
    expect(wrapper.find('.list-header .header-create').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('App 回收站详情', () => {
  it('回收站里点条目也能看详情，且详情是只读的', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '删掉的笔记')
    await notes.trash(note.id)

    ui.view = 'trash'
    await notes.load()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    await wrapper.find(`[data-note-id="${note.id}"]`).trigger('click')
    await wrapper.vm.$nextTick()

    expect(notes.currentId).toBe(note.id)
    expect(wrapper.findComponent(NoteDetail).props('readonly')).toBe(true)
    expect(wrapper.find('.editor-top-bar').text()).toContain('此笔记在回收站中')
    wrapper.unmount()
  })

  it('普通视图下详情可编辑', async () => {
    const notes = useNotesStore()
    await notes.create()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(NoteDetail).props('readonly')).toBe(false)
    wrapper.unmount()
  })
})
