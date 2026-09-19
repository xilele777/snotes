import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { version as appVersion } from '../../package.json'
import { db } from '../db/schema'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import GroupSidebar from './GroupSidebar.vue'
import { updateInfo } from '../update-check'

const syncNow = vi.hoisted(() => vi.fn())
vi.mock('../sync/engine', () => ({ syncNow }))
// 版本检查会请求 GitHub，单测里不出网；updateInfo 保留为真实 ref 以便用例直接赋值
const checkForUpdate = vi.hoisted(() => vi.fn())
vi.mock('../update-check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-check')>()),
  checkForUpdate,
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  // 弹窗 Teleport 到 body，上一条用例的残留会污染 querySelector
  document.body.innerHTML = ''
  syncNow.mockReset().mockResolvedValue(undefined)
  checkForUpdate.mockReset().mockResolvedValue(null)
  updateInfo.value = null
})

/** 弹窗被 Teleport 到 body，取不到 wrapper 里，只能走 document */
const dialog = () => document.querySelector<HTMLElement>('.dialog')
const dialogInput = () => document.querySelector<HTMLInputElement>('.dialog-input')
const dialogBtn = (kind: 'ok' | 'cancel') =>
  document.querySelector<HTMLButtonElement>(`.dialog-btn.${kind}`)

async function typeName(name: string) {
  const input = dialogInput()!
  input.value = name
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

describe('GroupSidebar', () => {
  it('渲染固定视图入口', async () => {
    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('全部笔记')
    expect(wrapper.text()).toContain('星标')
    expect(wrapper.text()).toContain('回收站')
  })

  it('渲染分组列表', async () => {
    const groups = useGroupsStore()
    await groups.create('工作')
    await groups.create('生活')

    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('工作')
    expect(wrapper.text()).toContain('生活')
  })

  it('点击分组切换视图与激活分组', async () => {
    const groups = useGroupsStore()
    const ui = useUiStore()
    const g = await groups.create('工作')

    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()
    await wrapper.find(`[data-group-id="${g.group_id}"]`).trigger('click')

    expect(ui.view).toBe('group')
    expect(ui.activeGroupId).toBe(g.group_id)
  })

  it('回收站位于星标下面，切换后保留相同的笔记导航', async () => {
    const ui = useUiStore()
    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-view="trash"]').trigger('click')

    expect(ui.view).toBe('trash')
    expect(wrapper.find('.sidebar-content').exists()).toBe(true)
    expect(wrapper.findAll('.views > li').map(item => item.attributes('data-view'))).toEqual(['all', 'star', 'trash'])
    expect(wrapper.find('.app-rail [data-view="trash"]').exists()).toBe(false)
    expect(wrapper.get('[data-view="trash"] button').attributes('aria-current')).toBe('page')
    wrapper.unmount()
  })

  it('软删除的分组不出现在列表中', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('临时')
    await groups.remove(g.group_id)

    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('临时')
  })

  it('暂时不渲染数据监控入口', async () => {
    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()

    const entry = wrapper.find('[data-view="metrics"]')
    expect(entry.exists()).toBe(false)
  })

  it('统计打开弹窗并收起抽屉，保留底下的分组视图', async () => {
    const ui = useUiStore()
    ui.view = 'group'
    ui.activeGroupId = 'work'
    ui.drawerOpen = true

    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-view="stats"]').trigger('click')

    expect(ui.statsOpen).toBe(true)
    expect(ui.view).toBe('group')
    expect(ui.activeGroupId).toBe('work')
    expect(ui.drawerOpen).toBe(false)
    expect(wrapper.find('.sidebar-content').exists()).toBe(true)
    expect(wrapper.get('[data-view="stats"]').attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it.each(['trash', 'metrics'] as const)('从 %s 且没有历史笔记位置时，返回全部笔记', async (view) => {
    const ui = useUiStore()
    ui.view = view
    ui.drawerOpen = true

    const wrapper = mount(GroupSidebar)
    expect(wrapper.find('.sidebar-content').exists()).toBe(view === 'trash')
    await wrapper.get('.rail-button[aria-label="笔记"]').trigger('click')
    await flushPromises()

    expect(ui.view).toBe('all')
    expect(ui.activeGroupId).toBeNull()
    expect(ui.drawerOpen).toBe(false)
    expect(wrapper.get('.rail-button[aria-label="笔记"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.sidebar-content').exists()).toBe(true)
    wrapper.unmount()
  })

  it('已经在分组内时点击笔记图标不会重置分组', async () => {
    const ui = useUiStore()
    ui.view = 'group'
    ui.activeGroupId = 'work'
    ui.drawerOpen = true
    const wrapper = mount(GroupSidebar)

    await wrapper.get('.rail-button[aria-label="笔记"]').trigger('click')

    expect(ui.view).toBe('group')
    expect(ui.activeGroupId).toBe('work')
    expect(ui.drawerOpen).toBe(false)
    wrapper.unmount()
  })

  it('删除分组后组内笔记回到未分组而非被删除', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('临时')
    await db.notes.add({
      id: 'n1',
      group_id: g.group_id,
      title: 't',
      summary: '',
      thumbnail: null,
      version: 1,
      prop_version: 1,
      star: 0,
      top: 0,
      skin_color: null,
      invalid: 0,
      create_time: 1,
      update_time: 1,
      body: '',
      body_version: 1,
      dirty: 'none',
    })

    await groups.remove(g.group_id)

    const note = await db.notes.get('n1')
    expect(note).toBeDefined()
    expect(note!.group_id).toBeNull()
  })
})

describe('GroupSidebar 底部版本与同步入口', () => {
  it('版本按钮读取 package.json，点击打开版本信息并支持关闭', async () => {
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    const button = wrapper.get('.user-area .version-button')

    expect(button.element.tagName).toBe('BUTTON')
    expect(button.text()).toBe(`v${appVersion}`)
    await button.trigger('click')
    await nextTick()

    const versionDialog = document.querySelector<HTMLElement>('[aria-label="版本信息"]')!
    expect(versionDialog.textContent).toContain(`v${appVersion}`)
    const closeButton = versionDialog.querySelector<HTMLButtonElement>('button')!
    expect(document.activeElement).toBe(closeButton)

    closeButton.click()
    await nextTick()

    expect(document.querySelector('[aria-label="版本信息"]')).toBeNull()
    expect(document.activeElement).toBe(button.element)
    wrapper.unmount()
  })

  it('版本弹窗限制 Tab 焦点，Esc 关闭并阻止外层快捷键', async () => {
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.get('.version-button').trigger('click')
    await nextTick()
    const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="版本信息"] button')!
    document.querySelector<HTMLAnchorElement>('[aria-label="版本信息"] a')!.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })
    window.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(closeButton)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(escape)
    await nextTick()

    expect(escape.defaultPrevented).toBe(true)
    expect(document.querySelector('[aria-label="版本信息"]')).toBeNull()
    wrapper.unmount()
  })

  it('挂载时触发一次版本检查；没有新版本时不显示提示点', async () => {
    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.version-button').classes()).not.toContain('has-update')
    wrapper.unmount()
  })

  it('检测到新版本时版本按钮带提示点，弹窗给出更新命令与发布页链接', async () => {
    updateInfo.value = { latest: '9.9.9', url: 'https://github.com/xilele777/snotes/releases/tag/v9.9.9', hasUpdate: true }
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    const button = wrapper.get('.version-button')
    expect(button.classes()).toContain('has-update')
    expect(button.attributes('title')).toContain('v9.9.9')

    await button.trigger('click')
    await nextTick()
    const versionDialog = document.querySelector<HTMLElement>('[aria-label="版本信息"]')!
    expect(versionDialog.textContent).toContain('v9.9.9')
    expect(versionDialog.textContent).toContain('npm run deploy')
    const link = versionDialog.querySelector<HTMLAnchorElement>('a')!
    expect(link.href).toBe('https://github.com/xilele777/snotes/releases/tag/v9.9.9')
    expect(link.target).toBe('_blank')
    const close = versionDialog.querySelector<HTMLButtonElement>('.dialog-btn')!
    close.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(link)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(close)
    wrapper.unmount()
  })

  it('点击版本弹窗遮罩可以关闭', async () => {
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.get('.version-button').trigger('click')
    document.querySelector<HTMLElement>('.dialog-mask')!.click()
    await nextTick()

    expect(document.querySelector('[aria-label="版本信息"]')).toBeNull()
    wrapper.unmount()
  })

  it('云朵是可访问的按钮，点击触发手动同步', async () => {
    const wrapper = mount(GroupSidebar)
    const button = wrapper.get('.sync-idle')

    expect(button.element.tagName).toBe('BUTTON')
    expect(button.attributes('aria-label')).toBe('立即同步')
    await button.trigger('click')

    expect(syncNow).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('同步期间显示加载状态并禁止重复点击，完成后恢复', async () => {
    const ui = useUiStore()
    let finishSync!: () => void
    syncNow.mockImplementationOnce(async () => {
      ui.syncing = true
      await new Promise<void>((resolve) => { finishSync = resolve })
      ui.syncing = false
    })
    const wrapper = mount(GroupSidebar)
    const button = wrapper.get<HTMLButtonElement>('.sync-idle')
    await button.trigger('click')

    expect(button.element.disabled).toBe(true)
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('title')).toBe('正在同步…')
    expect(button.find('.sync-spinner').exists()).toBe(true)
    await button.trigger('click')
    expect(syncNow).toHaveBeenCalledOnce()

    finishSync()
    await flushPromises()

    expect(button.element.disabled).toBe(false)
    expect(button.attributes('aria-label')).toBe('立即同步')
    expect(button.find('.sync-spinner').exists()).toBe(false)
    wrapper.unmount()
  })

  it('同步失败与未推送数量可见，仍允许点击再次同步', async () => {
    const ui = useUiStore()
    ui.failedCount = 2
    const wrapper = mount(GroupSidebar)
    const button = wrapper.get('.sync-idle')
    expect(button.attributes('title')).toContain('2 条改动未推送')
    expect(button.get('.failed-badge').text()).toBe('2')

    ui.lastSyncError = '网络连接失败'
    await nextTick()
    expect(button.classes()).toContain('has-failed')
    expect(button.attributes('title')).toContain('网络连接失败')
    await button.trigger('click')
    expect(syncNow).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})

describe('GroupSidebar 新建分组弹窗', () => {
  it('侧栏底部不再有常驻输入框，入口是分组标题行的 +', async () => {
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.new-group').exists()).toBe(false)
    expect(wrapper.find('.group-add').attributes('aria-label')).toBe('新建分组')
    expect(dialog()).toBeNull()
    wrapper.unmount()
  })

  it('点 + 弹出「新建分组」，填名字确定后入库', async () => {
    const groups = useGroupsStore()

    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.group-add').trigger('click')

    expect(dialog()).not.toBeNull()
    expect(document.querySelector('.dialog-title')!.textContent).toBe('新建分组')

    await typeName('工作')
    dialogBtn('ok')!.click()

    await vi.waitFor(() => {
      expect(groups.groups.map((g) => g.name)).toContain('工作')
    })
    await nextTick()
    expect(dialog()).toBeNull()
    wrapper.unmount()
  })

  it('名字为空时确定不可点', async () => {
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.group-add').trigger('click')

    expect(dialogBtn('ok')!.disabled).toBe(true)
    await typeName('   ')
    expect(dialogBtn('ok')!.disabled).toBe(true)
    wrapper.unmount()
  })

  it('取消关闭弹窗且不建分组', async () => {
    const groups = useGroupsStore()

    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.group-add').trigger('click')
    await typeName('不要建')
    dialogBtn('cancel')!.click()
    await nextTick()

    expect(dialog()).toBeNull()
    expect(groups.groups).toHaveLength(0)
    wrapper.unmount()
  })

  // 原站是 close-on-press-escape:false / close-on-click-modal:false，这里刻意不照抄
  it('Esc 关闭弹窗', async () => {
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.group-add').trigger('click')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect(dialog()).toBeNull()
    wrapper.unmount()
  })

  it('点遮罩关闭弹窗', async () => {
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.group-add').trigger('click')

    document.querySelector<HTMLElement>('.dialog-mask')!.click()
    await nextTick()

    expect(dialog()).toBeNull()
    wrapper.unmount()
  })

  it('回车提交等同于点确定', async () => {
    const groups = useGroupsStore()

    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.group-add').trigger('click')
    await typeName('生活')
    dialogInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    await vi.waitFor(() => {
      expect(groups.groups.map((g) => g.name)).toContain('生活')
    })
    wrapper.unmount()
  })

  it('点 ⋯ 打开菜单选「重命名」，复用同一弹窗改标题为「重命名」，预填旧名并提交', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('旧名')

    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find(`[data-group-id="${g.group_id}"] .group-menu-btn`).trigger('click')
    document.querySelector<HTMLButtonElement>('[role="menu"] [data-action="rename"]')!.click()
    await nextTick()

    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.querySelector('.dialog-title')!.textContent).toBe('重命名')
    expect(dialogInput()!.value).toBe('旧名')

    await typeName('新名')
    dialogBtn('ok')!.click()

    // 弹窗在 rename 全部落库（含 outbox 与重新 load）后才关闭；等它关掉再查库，收尾时就不会留下悬挂的 IndexedDB 操作
    await vi.waitFor(() => expect(dialog()).toBeNull())
    expect((await db.groups.get(g.group_id))!.name).toBe('新名')
    expect(groups.groups[0].name).toBe('新名')
    wrapper.unmount()
  })

  it('点 ⋯ 不会顺带把视图切到那个分组', async () => {
    const groups = useGroupsStore()
    const ui = useUiStore()
    const g = await groups.create('工作')

    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find(`[data-group-id="${g.group_id}"] .group-menu-btn`).trigger('click')

    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(ui.view).toBe('all')
    expect(ui.activeGroupId).toBeNull()
    wrapper.unmount()
  })
})

describe('GroupSidebar 分组菜单', () => {
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
  const action = (name: string) => document.querySelector<HTMLButtonElement>(`[role="menu"] [data-action="${name}"]`)
  const confirmDialog = () => document.querySelector<HTMLElement>('.confirm-dialog')

  async function openMenu(wrapper: ReturnType<typeof mount>, groupId: string) {
    const button = wrapper.find(`[data-group-id="${groupId}"] .group-menu-btn`)
    await button.trigger('click')
    await nextTick()
    return button
  }

  it('菜单列出重命名、颜色、上移下移与删除，首项获得焦点；Esc 关闭并把焦点还给 ⋯', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('工作')
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    const button = await openMenu(wrapper, g.group_id)
    expect(menu()).not.toBeNull()
    expect(button.attributes('aria-expanded')).toBe('true')
    for (const name of ['rename', 'up', 'down', 'remove']) expect(action(name)).not.toBeNull()
    expect(menu()!.querySelectorAll('[role="menuitemradio"]')).toHaveLength(6)
    expect(document.activeElement).toBe(action('rename'))

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(escape)
    await nextTick()

    expect(escape.defaultPrevented).toBe(true)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button.element)
    wrapper.unmount()
  })

  it('点菜单外部关闭菜单，再点 ⋯ 可切换开关', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('工作')
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    const button = await openMenu(wrapper, g.group_id)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(menu()).toBeNull()

    await button.trigger('click')
    expect(menu()).not.toBeNull()
    await button.trigger('click')
    expect(menu()).toBeNull()
    wrapper.unmount()
  })

  it('选颜色写入分组 color、收起菜单，侧栏图标随之着色', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('工作')
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    await openMenu(wrapper, g.group_id)
    menu()!.querySelector<HTMLButtonElement>('[aria-label="标记颜色 #d8b46a"]')!.click()

    // setColor 落库后会重新 load，等 store 更新完再看渲染结果
    await vi.waitFor(() => expect(groups.groups[0].color).toBe('#d8b46a'))
    expect((await db.groups.get(g.group_id))!.color).toBe('#d8b46a')
    await nextTick()
    expect(menu()).toBeNull()
    expect(wrapper.find(`[data-group-id="${g.group_id}"] .group-icon`).attributes('style')).toContain('rgb(216, 180, 106)')

    await openMenu(wrapper, g.group_id)
    expect(menu()!.querySelector('[aria-label="标记颜色 #d8b46a"]')!.getAttribute('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('上移 / 下移交换顺序并持久化 ord，处于两端时对应项禁用', async () => {
    const groups = useGroupsStore()
    const a = await groups.create('甲')
    const b = await groups.create('乙')
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    await openMenu(wrapper, a.group_id)
    expect(action('up')!.disabled).toBe(true)
    expect(action('down')!.disabled).toBe(false)
    action('down')!.click()

    await vi.waitFor(() => {
      expect(groups.groups.map((g) => g.name)).toEqual(['乙', '甲'])
    })
    expect((await db.groups.get(b.group_id))!.ord).toBe(0)
    expect((await db.groups.get(a.group_id))!.ord).toBe(1)
    await nextTick()
    expect(wrapper.findAll('.groups .group-name').map((el) => el.text())).toEqual(['乙', '甲'])

    await openMenu(wrapper, a.group_id)
    expect(action('down')!.disabled).toBe(true)
    action('up')!.click()
    await vi.waitFor(() => {
      expect(groups.groups.map((g) => g.name)).toEqual(['甲', '乙'])
    })
    wrapper.unmount()
  })

  it('删除先弹确认；确认后分组消失，组内笔记回到未分组', async () => {
    const groups = useGroupsStore()
    const notes = useNotesStore()
    const g = await groups.create('临时')
    const note = await notes.create()
    await notes.setProps(note.id, { group_id: g.group_id })
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    await openMenu(wrapper, g.group_id)
    action('remove')!.click()
    await nextTick()

    expect(menu()).toBeNull()
    expect(confirmDialog()).not.toBeNull()
    expect(confirmDialog()!.textContent).toContain('删除分组「临时」')
    expect(confirmDialog()!.textContent).toContain('组内笔记会回到未分组')
    // 未确认前什么都不动
    expect((await db.groups.get(g.group_id))!.invalid).toBe(0)

    confirmDialog()!.querySelector<HTMLButtonElement>('[data-op="confirm"]')!.click()

    await vi.waitFor(async () => {
      expect((await db.groups.get(g.group_id))!.invalid).toBe(1)
      expect(notes.notes.find((n) => n.id === note.id)?.group_id).toBeNull()
    })
    await nextTick()
    expect(confirmDialog()).toBeNull()
    expect(wrapper.text()).not.toContain('临时')
    wrapper.unmount()
  })

  it('删除确认可取消，分组保留', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('保留')
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    await openMenu(wrapper, g.group_id)
    action('remove')!.click()
    await nextTick()
    confirmDialog()!.querySelector<HTMLButtonElement>('[data-op="cancel"]')!.click()
    await nextTick()

    expect(confirmDialog()).toBeNull()
    expect((await db.groups.get(g.group_id))!.invalid).toBe(0)
    expect(wrapper.text()).toContain('保留')
    wrapper.unmount()
  })

  it('删除正在查看的分组后切回全部笔记', async () => {
    const groups = useGroupsStore()
    const notes = useNotesStore()
    const ui = useUiStore()
    const g = await groups.create('当前')
    ui.view = 'group'
    ui.activeGroupId = g.group_id
    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    await openMenu(wrapper, g.group_id)
    action('remove')!.click()
    await nextTick()
    confirmDialog()!.querySelector<HTMLButtonElement>('[data-op="confirm"]')!.click()

    await vi.waitFor(() => {
      expect(ui.view).toBe('all')
      expect(ui.activeGroupId).toBeNull()
      // 切视图后的 notes.load() 跑完 stale 才会变 false，等它结束再卸载
      expect(notes.stale).toBe(false)
    })
    wrapper.unmount()
  })
})
