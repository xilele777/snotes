import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import MilkdownEditor from '../editor/MilkdownEditor.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import NoteDetail from './NoteDetail.vue'

// Milkdown 起真实 ProseMirror，单测里换成空壳
vi.mock('@milkdown/vue', () => ({
  Milkdown: { template: '<div class="milkdown-mock" />' },
  MilkdownProvider: { template: '<div><slot /></div>' },
  useEditor: () => ({ loading: { value: false }, get: () => undefined }),
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

/** 顶栏动作都带 data-op，避免按下标取按钮——加一颗图标就会把所有断言错位 */
const op = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.find(`[data-op="${name}"]`)

describe('NoteDetail 顶栏操作条', () => {
  it('不再重复展示笔记标题', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '# 会议纪要\n正文')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.editor-top-bar').text()).not.toContain('会议纪要')
    wrapper.unmount()
  })

  it('五个动作全部摊在顶栏上，不用先点开菜单', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    for (const name of ['top', 'star', 'color', 'group', 'trash']) {
      expect(op(wrapper, name).exists()).toBe(true)
    }
    wrapper.unmount()
  })

  it('置顶按钮翻转 top 并进入 selected 态', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'top').trigger('click')

    await vi.waitFor(() => {
      expect(notes.notes.find((n) => n.id === note.id)?.top).toBe(1)
    })
    expect((await db.notes.get(note.id))!.top).toBe(1)

    await wrapper.vm.$nextTick()
    expect(op(wrapper, 'top').classes()).toContain('selected')
    wrapper.unmount()
  })

  it('星标按钮翻转 star', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'star').trigger('click')

    await vi.waitFor(() => {
      expect(notes.notes.find((n) => n.id === note.id)?.star).toBe(1)
    })
    expect((await db.notes.get(note.id))!.star).toBe(1)
    wrapper.unmount()
  })

  it('颜色浮层写入 skin_color 并收起', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.op-popover.colors').exists()).toBe(false)
    await op(wrapper, 'color').trigger('click')
    expect(wrapper.find('.op-popover.colors').exists()).toBe(true)

    // 第二个色板是 yellow #fed634，第一个是「清除颜色」
    await wrapper.findAll('.more-swatch')[1].trigger('click')

    await vi.waitFor(() => {
      expect(notes.notes.find((n) => n.id === note.id)?.skin_color).toBe('#fed634')
    })
    expect((await db.notes.get(note.id))!.skin_color).toBe('#fed634')
    expect(wrapper.find('.op-popover.colors').exists()).toBe(false)
    wrapper.unmount()
  })

  it('分组浮层写入 group_id', async () => {
    const groups = useGroupsStore()
    const g = await groups.create('工作')
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'group').trigger('click')

    const opts = wrapper.findAll('.group-opt')
    // 第一项固定是「未分组」，分组接在后面
    expect(opts[0].text()).toBe('未分组')
    await opts[1].trigger('click')

    await vi.waitFor(() => {
      expect(notes.notes.find((n) => n.id === note.id)?.group_id).toBe(g.group_id)
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
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'group').trigger('click')
    await wrapper.findAll('.group-opt')[0].trigger('click')

    await vi.waitFor(() => {
      expect(notes.notes.find((n) => n.id === note.id)?.group_id).toBeNull()
    })
    expect((await db.notes.get(note.id))!.group_id).toBeNull()
    wrapper.unmount()
  })

  it('删除按钮先弹确认，确认后才把笔记移入回收站', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'trash').trigger('click')

    // 未确认前不动任何数据
    expect(wrapper.find('.confirm-dialog').exists()).toBe(true)
    expect(notes.notes.find((n) => n.id === note.id)).toBeDefined()

    await wrapper.find('[data-op="confirm"]').trigger('click')

    await vi.waitFor(() => {
      expect(notes.notes.find((n) => n.id === note.id) == null).toBe(true)
    })
    expect((await db.notes.get(note.id))!.invalid).toBe(1)
    wrapper.unmount()
  })

  it('删除弹窗点取消不删任何东西', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'trash').trigger('click')
    await wrapper.find('[data-op="cancel"]').trigger('click')

    expect(wrapper.find('.confirm-dialog').exists()).toBe(false)
    expect(notes.notes.find((n) => n.id === note.id)).toBeDefined()
    wrapper.unmount()
  })

  it('撤销/重做按钮渲染在编辑态顶栏，点击只是空转不报错', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(op(wrapper, 'undo').exists()).toBe(true)
    expect(op(wrapper, 'redo').exists()).toBe(true)
    // 编辑器是 @milkdown/vue 空壳，expose 的方法点了不该抛
    await op(wrapper, 'undo').trigger('click')
    await op(wrapper, 'redo').trigger('click')
    expect(notes.notes.find((n) => n.id === note.id)).toBeDefined()
    wrapper.unmount()
  })

  it('点浮层外部收起浮层', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'color').trigger('click')
    expect(wrapper.find('.op-popover.colors').exists()).toBe(true)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.op-popover.colors').exists()).toBe(false)
    wrapper.unmount()
  })

  it('顶栏渲染文档信息与字数统计入口', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(op(wrapper, 'info').exists()).toBe(true)
    expect(op(wrapper, 'wordcount').exists()).toBe(true)
    wrapper.unmount()
  })

  it('点文档信息入口打开信息弹窗', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'info').trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = document.querySelector('.info-dialog')
    expect(dialog).toBeTruthy()
    expect(dialog!.textContent).toContain('文档信息')
    wrapper.unmount()
  })

  it('点字数统计入口打开字数弹窗，显示当前字数', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '今天天气不错 hello')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'wordcount').trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = document.querySelector('.wordcount-dialog')
    expect(dialog).toBeTruthy()
    // 中文 6 字 + 英文 1 词 = 7
    expect(dialog!.textContent).toContain('7')
    wrapper.unmount()
  })
})

describe('NoteDetail 回收站只读态', () => {
  async function mountTrashed() {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '删掉的笔记')
    await notes.trash(note.id)

    ui.view = 'trash'
    await notes.load()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { props: { readonly: true }, attachTo: document.body })
    await wrapper.vm.$nextTick()
    return { notes, note, wrapper }
  }

  it('渲染回收站提示与恢复 / 彻底删除，不渲染编辑动作', async () => {
    const { wrapper } = await mountTrashed()

    expect(wrapper.text()).toContain('此笔记在回收站中')
    expect(op(wrapper, 'recover').exists()).toBe(true)
    expect(op(wrapper, 'purge').exists()).toBe(true)
    expect(op(wrapper, 'top').exists()).toBe(false)
    expect(op(wrapper, 'trash').exists()).toBe(false)
    expect(op(wrapper, 'undo').exists()).toBe(false)
    expect(op(wrapper, 'redo').exists()).toBe(false)
    wrapper.unmount()
  })

  it('正文可见但编辑器为只读', async () => {
    const { wrapper } = await mountTrashed()

    const editor = wrapper.findComponent(MilkdownEditor)
    expect(editor.exists()).toBe(true)
    expect(editor.props('modelValue')).toBe('删掉的笔记')
    expect(editor.props('editable')).toBe(false)
    wrapper.unmount()
  })

  it('恢复按钮把笔记移出回收站', async () => {
    const { notes, note, wrapper } = await mountTrashed()

    await op(wrapper, 'recover').trigger('click')

    await vi.waitFor(async () => {
      expect((await db.notes.get(note.id))!.invalid).toBe(0)
    })
    // 已经不在回收站列表里了，详情不能再指着它
    await vi.waitFor(() => {
      expect(notes.currentId).toBeNull()
    })
    wrapper.unmount()
  })

  it('彻底删除先弹确认，确认后物理删除笔记并清空当前选中', async () => {
    const { notes, note, wrapper } = await mountTrashed()

    await op(wrapper, 'purge').trigger('click')
    expect(wrapper.find('.confirm-dialog').exists()).toBe(true)
    expect(wrapper.find('.dialog-title').text()).toBe('彻底删除这条笔记？')

    await wrapper.find('[data-op="confirm"]').trigger('click')

    // DB 删除先完成、load() 清 currentId 后完成，两件事得放进同一个 waitFor
    await vi.waitFor(async () => {
      expect(await db.notes.get(note.id)).toBeUndefined()
      expect(notes.currentId).toBeNull()
    })
    wrapper.unmount()
  })
})
