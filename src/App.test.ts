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

// Vditor 的真实 DOM 与解析器由浏览器测试覆盖。
vi.mock('vditor', async () => ({ default: (await import('../tests/unit/mock-vditor')).MockVditor }))
vi.mock('./editor/vditor-assets', () => ({ loadVditorAssets: vi.fn().mockResolvedValue(undefined) }))
// 令牌态默认放行，进 layout 分支
vi.mock('./api/token', async () => {
  const { ref } = await import('vue')
  return { hasToken: ref(true) }
})
// 侧栏挂载会检查 GitHub 新版本，单测不出网
vi.mock('./update-check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./update-check')>()),
  checkForUpdate: vi.fn().mockResolvedValue(null),
}))
// 监控页走 apiMetrics，App 级用例不关心它真的拉到什么数据
const apiMetrics = vi.hoisted(() => vi.fn())
vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/client')>()),
  apiMetrics,
}))

beforeEach(async () => {
  window.history.replaceState(null, '', '/')
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
  it('Ctrl+F 直接聚焦列表搜索', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true }))
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('.note-search input').element)
    wrapper.unmount()
  })

  it('输入法组合输入与弹窗内的快捷键不会新建笔记', async () => {
    const notes = useNotesStore()
    const create = vi.spyOn(notes, 'create')
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', altKey: true, isComposing: true }))
    expect(create).not.toHaveBeenCalled()

    await wrapper.get('.group-add').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', altKey: true }))
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
    expect(wrapper.find('.editor-top-bar').text()).toContain('此笔记还有 30 天被删除')
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

describe('App 统计页面', () => {
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
    vi.spyOn(trigger.element, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    trigger.element.focus()

    await trigger.trigger('click')
    await flushPromises()

    expect(ui.view).toBe('group')
    expect(ui.activeGroupId).toBe(group.group_id)
    expect(ui.query).toBe('项目')
    expect(notes.currentId).toBe(note.id)
    expect(wrapper.getComponent(NoteDetail).vm.$.uid).toBe(detailId)
    expect(wrapper.get('.editor-body').element).toBe(editor)
    expect(wrapper.get('.layout').attributes('inert')).toBeUndefined()
    expect(wrapper.get('.list-pane').attributes('inert')).toBeDefined()
    const dialog = document.querySelector('[role="region"][aria-label="统计"]')!
    const close = dialog.querySelector<HTMLButtonElement>('[aria-label="返回工作区"]')!
    expect(document.activeElement).toBe(dialog.querySelector('h1'))
    const create = vi.spyOn(notes, 'create')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', altKey: true, cancelable: true }))
    expect(create).not.toHaveBeenCalled()

    close.click()
    await vi.waitFor(() => expect(history.state.workspacePage).toBeNull())
    await flushPromises()
    expect(document.querySelector('[role="region"][aria-label="统计"]')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    expect(wrapper.getComponent(NoteDetail).vm.$.uid).toBe(detailId)
    expect(notes.currentId).toBe(note.id)
    expect(ui.query).toBe('项目')
    wrapper.unmount()
  })
})

describe('App 扩展快捷键', () => {
  it('Ctrl+Shift+S 给当前笔记加星标，Ctrl+Shift+P 置顶', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true, cancelable: true }))
    await vi.waitFor(() => expect(notes.notes.find((n) => n.id === note.id)?.star).toBe(1))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, cancelable: true }))
    await vi.waitFor(() => expect(notes.notes.find((n) => n.id === note.id)?.top).toBe(1))
    wrapper.unmount()
  })

  it('Ctrl+Alt+↓ / ↑ 在列表里切换当前笔记', async () => {
    const notes = useNotesStore()
    const older = await notes.create()
    // Give the fixture distinct times; IDB's id order is otherwise arbitrary
    // when both creates finish within the same millisecond.
    await db.notes.update(older.id, { update_time: Date.now() - 1000 })
    const newer = await notes.create()
    const wrapper = mount(App, { attachTo: document.body })
    await vi.waitFor(() => expect(notes.currentId).toBe(newer.id))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, altKey: true, cancelable: true }))
    await vi.waitFor(() => expect(notes.currentId).toBe(older.id))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, altKey: true, cancelable: true }))
    await vi.waitFor(() => expect(notes.currentId).toBe(newer.id))
    wrapper.unmount()
  })

  it('Ctrl+Alt+D 经 ui.trashRequest 软删除并显示撤销', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    await notes.create()
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, altKey: true, cancelable: true }))
    expect(ui.trashRequest).toBe(1)
    await vi.waitFor(() => expect(document.body.textContent).toContain('笔记已移入回收站'))
    expect(document.body.textContent).toContain('撤销')
    expect(notes.notes).toHaveLength(0)
    wrapper.unmount()
  })

  it('Ctrl+, 打开设置页面，侧栏仍可操作，返回后恢复笔记', async () => {
    const ui = useUiStore()
    await useNotesStore().create()
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    const trigger = wrapper.get<HTMLButtonElement>('[data-view="settings"]')
    vi.spyOn(trigger.element, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    trigger.element.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, cancelable: true }))
    await flushPromises()

    expect(ui.workspacePage).toBe('settings')
    expect(wrapper.get('.layout').attributes('inert')).toBeUndefined()
    expect(wrapper.get('.list-pane').attributes('inert')).toBeDefined()
    expect(document.querySelector('[role="region"][aria-label="设置"]')).not.toBeNull()

    document.querySelector<HTMLButtonElement>('.settings-page [aria-label="返回工作区"]')!.click()
    await vi.waitFor(() => expect(ui.workspacePage).toBeNull())
    await flushPromises()
    expect(document.querySelector('[role="region"][aria-label="设置"]')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })

  it('Toast 挂在 App 上，提示文字渲染在顶部状态区', async () => {
    const { notify, dismissNotice } = await import('./notify')
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    // 前面用例可能留下带撤销操作的提示（新语义下普通消息会在它后面排队），先清场
    dismissNotice()
    notify('已复制 Markdown')
    await flushPromises()
    const host = document.querySelector('.toast-host')!
    expect(host.getAttribute('role')).toBe('status')
    expect(host.querySelector('.toast')!.textContent).toBe('已复制 Markdown')
    wrapper.unmount()
  })
})
