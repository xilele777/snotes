import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import TrashView from './TrashView.vue'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  // TrashView 调 confirm()，jsdom 下默认为 undefined，提前 stub
  vi.stubGlobal('confirm', () => true)
})

describe('TrashView', () => {
  it('恢复按钮把笔记移出回收站', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.trash(note.id)

    ui.view = 'trash'
    await notes.load()

    const wrapper = mount(TrashView)
    await wrapper.vm.$nextTick()
    await wrapper.find('.recover').trigger('click')

    expect((await db.notes.get(note.id))!.invalid).toBe(0)
  })

  it('回收站为空时不显示清空按钮', async () => {
    const ui = useUiStore()
    ui.view = 'trash'

    const wrapper = mount(TrashView)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.clean-all').exists()).toBe(false)
  })

  it('回收站非空时显示清空按钮', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.trash(note.id)

    ui.view = 'trash'
    await notes.load()

    const wrapper = mount(TrashView)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.clean-all').exists()).toBe(true)
  })

  it('点条目选中它——回收站也要能看笔记详情', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.trash(note.id)

    ui.view = 'trash'
    await notes.load()

    const wrapper = mount(TrashView)
    await wrapper.vm.$nextTick()
    await wrapper.find(`[data-note-id="${note.id}"]`).trigger('click')

    expect(notes.currentId).toBe(note.id)
  })

  it('回收站为空时显示空态', async () => {
    const ui = useUiStore()
    ui.view = 'trash'

    const wrapper = mount(TrashView)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.empty-state').text()).toContain('回收站是空的')
  })

  it('点彻底删除单条物理删除该笔记', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.trash(note.id)

    ui.view = 'trash'
    await notes.load()

    const wrapper = mount(TrashView)
    await wrapper.vm.$nextTick()
    await wrapper.find('.purge').trigger('click')

    // 单条彻底删除走 repo.purgeNote：本地删行 + 入队 scope='note' 的 purge 任务
    expect(await db.notes.get(note.id)).toBeUndefined()
  })
})
