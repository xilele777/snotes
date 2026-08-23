import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db/schema'
import { useGroupsStore } from './stores/groups'
import { useNotesStore } from './stores/notes'
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

describe('App 编辑器顶栏「更多」菜单', () => {
  it('点更多按钮展开菜单', async () => {
    const notes = useNotesStore()
    const note = await notes.create()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.more-popover').exists()).toBe(false)
    await wrapper.find('.more-btn').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.more-popover').exists()).toBe(true)

    wrapper.unmount()
    void note
  })

  it('置顶项翻转 top', async () => {
    const notes = useNotesStore()
    const note = await notes.create()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.more-btn').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.more-item')[0].trigger('click')

    await vi.waitFor(() => {
      expect((notes.notes.find((n) => n.id === note.id))?.top).toBe(1)
    })
    expect((await db.notes.get(note.id))!.top).toBe(1)
    wrapper.unmount()
  })

  it('星标项翻转 star', async () => {
    const notes = useNotesStore()
    const note = await notes.create()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.more-btn').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.more-item')[1].trigger('click')

    await vi.waitFor(() => {
      expect((notes.notes.find((n) => n.id === note.id))?.star).toBe(1)
    })
    expect((await db.notes.get(note.id))!.star).toBe(1)
    wrapper.unmount()
  })

  it('点色板写入 skin_color', async () => {
    const notes = useNotesStore()
    const note = await notes.create()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.more-btn').trigger('click')
    await wrapper.vm.$nextTick()

    // 第二个色板是 yellow #fed634
    const swatches = wrapper.findAll('.more-swatch')
    await swatches[1].trigger('click')

    await vi.waitFor(() => {
      expect((notes.notes.find((n) => n.id === note.id))?.skin_color).toBe('#fed634')
    })
    expect((await db.notes.get(note.id))!.skin_color).toBe('#fed634')
    wrapper.unmount()
  })

  it('分组下拉写入 group_id', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('工作')
    const notes = useNotesStore()
    const note = await notes.create()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.more-btn').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.find('.more-group select').setValue(g.group_id)

    await vi.waitFor(() => {
      expect((notes.notes.find((n) => n.id === note.id))?.group_id).toBe(g.group_id)
    })
    expect((await db.notes.get(note.id))!.group_id).toBe(g.group_id)
    wrapper.unmount()
  })

  it('选「未分组」写入 null 而非空串', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('工作')
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.setProps(note.id, { group_id: g.group_id })

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.more-btn').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.find('.more-group select').setValue('')

    await vi.waitFor(() => {
      expect((notes.notes.find((n) => n.id === note.id))?.group_id).toBeNull()
    })
    expect((await db.notes.get(note.id))!.group_id).toBeNull()
    wrapper.unmount()
  })

  it('删除项把当前笔记移入回收站', async () => {
    const notes = useNotesStore()
    const note = await notes.create()

    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.find('.more-btn').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.find('.more-item.danger').trigger('click')

    await vi.waitFor(() => {
      expect((notes.notes.find((n) => n.id === note.id)) == null).toBe(true)
    })
    expect((await db.notes.get(note.id))!.invalid).toBe(1)
    wrapper.unmount()
  })
})
