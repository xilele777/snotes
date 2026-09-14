import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { version as appVersion } from '../../package.json'
import { db } from '../db/schema'
import { useGroupsStore } from '../stores/groups'
import { useUiStore } from '../stores/ui'
import GroupSidebar from './GroupSidebar.vue'

const syncNow = vi.hoisted(() => vi.fn())
vi.mock('../sync/engine', () => ({ syncNow }))

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  // 弹窗 Teleport 到 body，上一条用例的残留会污染 querySelector
  document.body.innerHTML = ''
  syncNow.mockReset().mockResolvedValue(undefined)
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

  it('点击回收站切到 trash 视图', async () => {
    const ui = useUiStore()
    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-view="trash"]').trigger('click')

    expect(ui.view).toBe('trash')
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

  it('点统计入口切到 stats 视图并收起抽屉', async () => {
    const ui = useUiStore()
    ui.drawerOpen = true

    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-view="stats"]').trigger('click')

    expect(ui.view).toBe('stats')
    expect(ui.activeGroupId).toBeNull()
    expect(ui.drawerOpen).toBe(false)
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

  it('点 ⋯ 复用同一弹窗改标题为「重命名」，预填旧名并提交', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('旧名')

    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find(`[data-group-id="${g.group_id}"] .rename-btn`).trigger('click')

    expect(document.querySelector('.dialog-title')!.textContent).toBe('重命名')
    expect(dialogInput()!.value).toBe('旧名')

    await typeName('新名')
    dialogBtn('ok')!.click()

    await vi.waitFor(async () => {
      expect((await db.groups.get(g.group_id))!.name).toBe('新名')
    })
    wrapper.unmount()
  })

  it('点 ⋯ 不会顺带把视图切到那个分组', async () => {
    const groups = useGroupsStore()
    const ui = useUiStore()
    const g = await groups.create('工作')

    const wrapper = mount(GroupSidebar, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find(`[data-group-id="${g.group_id}"] .rename-btn`).trigger('click')

    expect(ui.view).toBe('all')
    expect(ui.activeGroupId).toBeNull()
    wrapper.unmount()
  })
})
