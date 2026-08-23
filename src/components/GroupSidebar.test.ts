import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/schema'
import { useGroupsStore } from '../stores/groups'
import { useUiStore } from '../stores/ui'
import GroupSidebar from './GroupSidebar.vue'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

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

  it('点 ⋯ 进入重命名模式，回车提交', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('旧名')

    const wrapper = mount(GroupSidebar)
    await wrapper.vm.$nextTick()

    await wrapper.find(`[data-group-id="${g.group_id}"] .rename-btn`).trigger('click')
    const input = wrapper.find(`[data-group-id="${g.group_id}"] .rename-input`)
    expect(input.exists()).toBe(true)

    await input.setValue('新名')
    await input.trigger('keyup.enter')

    expect((await db.groups.get(g.group_id))!.name).toBe('新名')
  })
})
