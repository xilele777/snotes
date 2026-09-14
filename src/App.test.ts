import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db/schema'
import MetricsView from './components/MetricsView.vue'
import NoteDetail from './components/NoteDetail.vue'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import App from './App.vue'
import { useGroupsStore } from './stores/groups'

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
// 监控页走 apiMetrics，App 级用例不关心它真的拉到什么数据
const apiMetrics = vi.hoisted(() => vi.fn())
vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/client')>()),
  apiMetrics,
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  apiMetrics.mockReset()
  apiMetrics.mockResolvedValue({ error: 'not_configured' })
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
  it('Ctrl+K 退出专注模式并直接聚焦列表搜索', async () => {
    const notes = useNotesStore()
    await notes.create()
    const ui = useUiStore()
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    ui.focusMode = true

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }))
    await flushPromises()

    expect(ui.focusMode).toBe(false)
    expect(ui.drawerOpen).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('.note-search input').element)
    wrapper.unmount()
  })

  it('Esc 退出专注模式时保留当前笔记', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    const ui = useUiStore()
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    ui.focusMode = true
    await wrapper.vm.$nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await wrapper.vm.$nextTick()

    expect(ui.focusMode).toBe(false)
    expect(notes.currentId).toBe(note.id)
    wrapper.unmount()
  })

  it('输入法组合输入与弹窗内的快捷键不会新建笔记', async () => {
    const notes = useNotesStore()
    const create = vi.spyOn(notes, 'create')
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, isComposing: true }))
    expect(create).not.toHaveBeenCalled()

    await wrapper.get('.group-add').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
    expect(create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

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

describe('App 数据监控视图', () => {
  it('切到 metrics 视图渲染监控页而非笔记详情', async () => {
    const ui = useUiStore()
    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    ui.view = 'metrics'
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(wrapper.findComponent(MetricsView).exists()).toBe(true)
    expect(wrapper.findComponent(NoteDetail).exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('App 统计弹窗', () => {
  it('打开统计保留分组、搜索、笔记组件和编辑器，关闭后恢复焦点', async () => {
    const ui = useUiStore()
    const notes = useNotesStore()
    const group = await useGroupsStore().create('工作')
    ui.view = 'group'
    ui.activeGroupId = group.group_id
    const note = await notes.create()
    await notes.saveBody(note.id, '项目记录')
    ui.query = '项目'
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    const detailId = wrapper.getComponent(NoteDetail).vm.$.uid
    const editor = wrapper.get('.editor-body').element
    const trigger = wrapper.get<HTMLButtonElement>('[data-view="stats"]')
    trigger.element.focus()

    await trigger.trigger('click')
    await flushPromises()

    expect(ui.view).toBe('group')
    expect(ui.activeGroupId).toBe(group.group_id)
    expect(ui.query).toBe('项目')
    expect(notes.currentId).toBe(note.id)
    expect(wrapper.getComponent(NoteDetail).vm.$.uid).toBe(detailId)
    expect(wrapper.get('.editor-body').element).toBe(editor)
    expect(wrapper.get('.layout').attributes('inert')).toBeDefined()
    const dialog = document.querySelector('[role="dialog"][aria-label="记录统计"]')!
    const close = dialog.querySelector<HTMLButtonElement>('[aria-label="关闭统计"]')!
    expect(document.activeElement).toBe(close)
    const create = vi.spyOn(notes, 'create')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true }))
    expect(create).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await vi.waitFor(() => expect(history.state.statsOpen).toBe(false))
    await flushPromises()
    expect(document.querySelector('[role="dialog"][aria-label="记录统计"]')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    expect(wrapper.getComponent(NoteDetail).vm.$.uid).toBe(detailId)
    expect(notes.currentId).toBe(note.id)
    expect(ui.query).toBe('项目')
    wrapper.unmount()
  })
})
