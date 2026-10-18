import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { addKnowledgeBaseNode, createKnowledgeBase } from '../db/knowledge-base-repo'
import MilkdownEditor from '../editor/MilkdownEditor.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { dismissNotice, notice, runNoticeAction } from '../notify'
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
  document.body.innerHTML = ''
  dismissNotice()
})

/** 顶栏动作都带 data-op，避免按下标取按钮——加一颗图标就会把所有断言错位 */
const op = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.find(`[data-op="${name}"]`)

/** 「⋯」菜单 Teleport 到 body，条目按 data-action 取 */
const menu = () => document.querySelector<HTMLElement>('[role="menu"][aria-label="更多操作"]')
const menuAction = (name: string) => document.querySelector<HTMLButtonElement>(`[role="menu"][aria-label="更多操作"] [data-action="${name}"]`)
async function chooseMore(wrapper: ReturnType<typeof mount>, action: string) {
  await openMore(wrapper)
  menuAction(action)!.click()
  await wrapper.vm.$nextTick()
}
async function openMore(wrapper: ReturnType<typeof mount>) {
  await op(wrapper, 'more').trigger('click')
  await wrapper.vm.$nextTick()
}

/** 让 useMediaQuery('(max-width: 720px)') 命中，模拟手机顶栏 */
function mockCompact() {
  const original = window.matchMedia
  window.matchMedia = (query: string) => ({
    matches: query.includes('720'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
  return () => { window.matchMedia = original }
}

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

  it('顶栏保留高频动作，管理操作收进菜单', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    for (const name of ['top', 'star', 'group', 'more']) {
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
    await chooseMore(wrapper, 'color')
    expect(wrapper.find('.op-popover.colors').exists()).toBe(true)

    // 第一个是「清除颜色」，第二个是暖黄色。
    await wrapper.findAll('.more-swatch')[1].trigger('click')

    await vi.waitFor(() => {
      expect(notes.notes.find((n) => n.id === note.id)?.skin_color).toBe('#d8b46a')
    })
    expect((await db.notes.get(note.id))!.skin_color).toBe('#d8b46a')
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

  it('菜单删除直接移入回收站并提供撤销', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await chooseMore(wrapper, 'trash')

    expect(wrapper.find('.confirm-dialog').exists()).toBe(false)

    await vi.waitFor(() => {
      expect(notes.notes.find((n) => n.id === note.id) == null).toBe(true)
    })
    expect((await db.notes.get(note.id))!.invalid).toBe(1)
    wrapper.unmount()
  })

  it('删除后撤销恢复原笔记', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await chooseMore(wrapper, 'trash')
    await vi.waitFor(async () => expect((await db.notes.get(note.id))!.invalid).toBe(1))
    await runNoticeAction()

    expect(wrapper.find('.confirm-dialog').exists()).toBe(false)
    expect(notes.notes.find((n) => n.id === note.id)).toBeDefined()
    wrapper.unmount()
  })

  it('撤销/重做按钮渲染在格式工具栏，点击只是空转不报错', async () => {
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

  it('格式工具栏有插入图片按钮，点击打开图片文件选择器', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(op(wrapper, 'image').exists()).toBe(true)
    const input = wrapper.find<HTMLInputElement>('input[type="file"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('accept')).toBe('image/*')
    expect(input.attributes('multiple')).toBeDefined()

    const click = vi.spyOn(input.element, 'click')
    await op(wrapper, 'image').trigger('click')
    expect(click).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('选中文件后交给编辑器插入，并清空 input 以便再次选同一张', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    const editor = wrapper.findComponent(MilkdownEditor)
    // 父组件通过 ref 拿到的是 expose 代理，它实时读 instance.exposed；spy 必须打在这个对象上
    const exposed = editor.vm.$.exposed as { insertImages: (files: File[]) => void }
    const insert = vi.spyOn(exposed, 'insertImages').mockImplementation(() => {})

    const input = wrapper.find<HTMLInputElement>('input[type="file"]')
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')

    expect(insert).toHaveBeenCalledWith([file])
    expect(input.element.value).toBe('')
    wrapper.unmount()
  })

  it('点浮层外部收起浮层', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await chooseMore(wrapper, 'color')
    expect(wrapper.find('.op-popover.colors').exists()).toBe(true)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.op-popover.colors').exists()).toBe(false)
    wrapper.unmount()
  })

  it('桌面顶栏显示字数，文档信息和历史收进菜单', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '今天天气不错 hello')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.editor-footer').exists()).toBe(false)
    expect(op(wrapper, 'wordcount').text()).toContain('7 字')
    expect(op(wrapper, 'info').exists()).toBe(false)
    expect(op(wrapper, 'history').exists()).toBe(false)
    for (const name of ['share', 'help']) expect(op(wrapper, name).exists()).toBe(false)

    await op(wrapper, 'wordcount').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.wordcount-dialog')!.textContent).toContain('7')
    wrapper.unmount()
  })

  it('桌面「⋯」菜单列首页信息流开关、复制、下载、导入、打印；文档信息、历史、字数与删除统一进入菜单，首项获得焦点', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(menu()).toBeNull()
    await openMore(wrapper)

    expect(menu()).not.toBeNull()
    expect(op(wrapper, 'more').attributes('aria-expanded')).toBe('true')
    for (const name of ['home-feed', 'copy', 'download', 'import', 'print']) expect(menuAction(name)).not.toBeNull()
    expect(menuAction('import')!.previousElementSibling).toBe(menuAction('download'))
    for (const name of ['color', 'info', 'history', 'wordcount', 'trash']) expect(menuAction(name)).not.toBeNull()
    // jsdom 没有 navigator.share，不给分享入口
    expect(menuAction('share')).toBeNull()
    expect(document.activeElement).toBe(menuAction('notebooks'))

    // Esc 关闭并把焦点还给 ⋯
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(op(wrapper, 'more').element)
    wrapper.unmount()
  })

  it('≤720px：顶栏没有删除、字数、信息、历史按钮，都进「⋯」菜单；删除直接进入回收站', async () => {
    const restore = mockCompact()
    try {
      const notes = useNotesStore()
      const note = await notes.create()
      notes.currentId = note.id

      const wrapper = mount(NoteDetail, { attachTo: document.body })
      await wrapper.vm.$nextTick()

      for (const name of ['trash', 'wordcount', 'info', 'history']) expect(op(wrapper, name).exists()).toBe(false)
      await openMore(wrapper)
      for (const name of ['info', 'history', 'wordcount', 'trash', 'import']) expect(menuAction(name)).not.toBeNull()
      menuAction('trash')!.click()
      await wrapper.vm.$nextTick()

      expect(menu()).toBeNull()
      expect(wrapper.find('.confirm-dialog').exists()).toBe(false)
      await vi.waitFor(() => expect(notes.notes.find((n) => n.id === note.id) == null).toBe(true))
      wrapper.unmount()
    } finally {
      restore()
    }
  })

  it('顶栏「文档信息」打开信息弹窗，弹窗里不再有历史区块', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await chooseMore(wrapper, 'info')
    await wrapper.vm.$nextTick()

    const dialog = document.querySelector('.info-dialog')
    expect(dialog).toBeTruthy()
    expect(dialog!.textContent).toContain('文档信息')
    expect(dialog!.querySelector('.history')).toBeNull()
    wrapper.unmount()
  })

  it('手机上菜单「字数统计」打开字数弹窗，显示当前字数', async () => {
    const restore = mockCompact()
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '今天天气不错 hello')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await openMore(wrapper)
    menuAction('wordcount')!.click()
    await wrapper.vm.$nextTick()
    restore()

    const dialog = document.querySelector('.wordcount-dialog')
    expect(dialog).toBeTruthy()
    // 中文 6 字 + 英文 1 词 = 7
    expect(dialog!.textContent).toContain('7')
    wrapper.unmount()
  })

  it('菜单「复制 Markdown」写剪贴板并用顶部 Toast 提示；「打印」调用 window.print', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '# 标题')
    notes.currentId = note.id
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await openMore(wrapper)
    menuAction('copy')!.click()
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('# 标题')
    expect(notice.value).toBe('已复制 Markdown')
    expect(wrapper.find('.share-notice').exists()).toBe(false)

    await openMore(wrapper)
    menuAction('print')!.click()
    expect(print).toHaveBeenCalledTimes(1)
    print.mockRestore()
    wrapper.unmount()
  })

  it('导入 Markdown 新建并打开笔记，退出分组筛选并保留原笔记', async () => {
    const groups = useGroupsStore()
    const group = await groups.create('工作')
    const ui = useUiStore()
    ui.view = 'group'
    ui.activeGroupId = group.group_id
    const notes = useNotesStore()
    const original = await notes.create()
    await notes.saveBody(original.id, '# 原笔记\n\n保留正文')
    ui.query = '原笔记'
    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await openMore(wrapper)
    const input = wrapper.find<HTMLInputElement>('[data-input="markdown"]')
    const click = vi.spyOn(input.element, 'click')
    menuAction('import')!.click()
    expect(click).toHaveBeenCalledOnce()
    Object.defineProperty(input.element, 'files', { value: [new File(['# 导入的笔记\n\n**内容**'], '导入.md', { type: 'text/markdown' })] })
    await input.trigger('change')
    await vi.waitFor(() => expect(notes.current?.title).toBe('导入的笔记'))
    expect(notes.currentId).not.toBe(original.id)
    expect(ui.view).toBe('all')
    expect(ui.query).toBe('')
    expect((await db.notes.get(original.id))!.body).toBe('# 原笔记\n\n保留正文')
    expect(notice.value).toBe('已导入 1 条笔记')
    expect(await db.outbox.where('[note_id+kind]').equals([notes.currentId!, 'create']).count()).toBe(1)
    expect(input.element.value).toBe('')
    wrapper.unmount()
  })

  it('拒绝非 Markdown 文件，读取失败时提示错误并保留当前笔记', async () => {
    const notes = useNotesStore()
    const original = await notes.create()
    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    const input = wrapper.find<HTMLInputElement>('[data-input="markdown"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['bad'], 'bad.zip')], configurable: true })
    await input.trigger('change')
    expect(notice.value).toBe('请选择 .md 或 .markdown 文件')
    const unreadable = new File(['text'], 'broken.md')
    vi.spyOn(unreadable, 'text').mockRejectedValue(new Error('无法读取文件'))
    Object.defineProperty(input.element, 'files', { value: [unreadable], configurable: true })
    await input.trigger('change')
    await vi.waitFor(() => expect(notice.value).toBe('导入失败：无法读取文件'))
    expect(notes.currentId).toBe(original.id)
    expect(await db.notes.count()).toBe(1)
    await openMore(wrapper)
    expect(menuAction('import')?.disabled).toBe(false)
    wrapper.unmount()
  })

  it('快捷键请求（ui.trashRequest 自增）直接软删除，只读态不响应', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    ui.trashRequest += 1
    await wrapper.vm.$nextTick()
    await vi.waitFor(async () => expect((await db.notes.get(note.id))!.invalid).toBe(1))
    expect(wrapper.find('.confirm-dialog').exists()).toBe(false)
    await runNoticeAction()
    wrapper.unmount()

    const readonly = mount(NoteDetail, { props: { readonly: true }, attachTo: document.body })
    await readonly.vm.$nextTick()
    ui.trashRequest += 1
    await readonly.vm.$nextTick()
    expect(readonly.find('.confirm-dialog').exists()).toBe(false)
    readonly.unmount()
  })
})

describe('NoteDetail 编辑工具栏', () => {
  it('编辑态渲染格式工具栏，按钮齐全', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.format-bar').exists()).toBe(true)
    for (const action of ['bold', 'heading1', 'taskList', 'table', 'link']) {
      expect(wrapper.find(`[data-format="${action}"]`).exists()).toBe(true)
    }
    wrapper.unmount()
  })

  it('点格式按钮转给编辑器，编辑器未就绪时空转不报错', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    const exposed = wrapper.findComponent(MilkdownEditor).vm.$.exposed as {
      format: (action: string) => void
      insertTable: () => void
    }
    const format = vi.spyOn(exposed, 'format').mockImplementation(() => {})

    await wrapper.find('[data-format="bold"]').trigger('click')

    expect(format).toHaveBeenCalledWith('bold')
    wrapper.unmount()
  })

  it('点表格按钮打开弹窗，自定义行列后交给编辑器插入', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    const exposed = wrapper.findComponent(MilkdownEditor).vm.$.exposed as {
      insertTable: (row: number, col: number) => void
    }
    const insertTable = vi.spyOn(exposed, 'insertTable').mockImplementation(() => {})

    expect(document.querySelector('.table-dialog')).toBeNull()
    await wrapper.find('[data-format="table"]').trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = document.querySelector('.table-dialog')!
    expect(dialog).not.toBeNull()
    expect(insertTable).not.toHaveBeenCalled()

    const rows = dialog.querySelector<HTMLInputElement>('[data-field="rows"]')!
    const cols = dialog.querySelector<HTMLInputElement>('[data-field="cols"]')!
    expect(rows.value).toBe('3')
    expect(cols.value).toBe('3')
    rows.value = '2'
    rows.dispatchEvent(new Event('input'))
    cols.value = '5'
    cols.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
    ;(dialog.querySelector('[data-op="confirm"]') as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()

    expect(insertTable).toHaveBeenCalledWith(2, 5)
    expect(document.querySelector('.table-dialog')).toBeNull()
    wrapper.unmount()
  })

  it('表格行列超出范围时确定按钮不可用', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    await wrapper.find('[data-format="table"]').trigger('click')
    await wrapper.vm.$nextTick()
    const dialog = document.querySelector('.table-dialog')!
    const rows = dialog.querySelector<HTMLInputElement>('[data-field="rows"]')!
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-op="confirm"]')!
    expect(confirm.disabled).toBe(false)

    rows.value = '0'
    rows.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
    expect(confirm.disabled).toBe(true)

    rows.value = '99'
    rows.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
    expect(confirm.disabled).toBe(true)
    wrapper.unmount()
  })

  it('点链接按钮打开弹窗，填好地址后交给编辑器写入', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    const exposed = wrapper.findComponent(MilkdownEditor).vm.$.exposed as {
      currentLink: () => { href: string; text: string } | null
      selectedText: () => string
      setLinkAt: (href: string, text: string) => void
    }
    vi.spyOn(exposed, 'currentLink').mockReturnValue(null)
    vi.spyOn(exposed, 'selectedText').mockReturnValue('参考资料')
    const setLinkAt = vi.spyOn(exposed, 'setLinkAt').mockImplementation(() => {})

    expect(document.querySelector('.link-dialog')).toBeNull()
    await wrapper.find('[data-format="link"]').trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = document.querySelector('.link-dialog')!
    expect(dialog.textContent).toContain('插入链接')
    // 选中的文字直接填进「文字」，少打一次字
    expect((dialog.querySelector('[data-field="text"]') as HTMLInputElement).value).toBe('参考资料')

    const href = dialog.querySelector('[data-field="href"]') as HTMLInputElement
    href.value = 'example.com'
    href.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
    ;(dialog.querySelector('[data-op="confirm"]') as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()

    expect(setLinkAt).toHaveBeenCalledWith('example.com', '参考资料')
    expect(document.querySelector('.link-dialog')).toBeNull()
    wrapper.unmount()
  })

  it('已有链接时弹窗预填地址并改成「编辑链接」', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    const exposed = wrapper.findComponent(MilkdownEditor).vm.$.exposed as {
      currentLink: () => { href: string; text: string } | null
    }
    vi.spyOn(exposed, 'currentLink').mockReturnValue({ href: 'https://a.cn', text: '文档' })

    await wrapper.find('[data-format="link"]').trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = document.querySelector('.link-dialog')!
    expect(dialog.textContent).toContain('编辑链接')
    expect((dialog.querySelector('[data-field="href"]') as HTMLInputElement).value).toBe('https://a.cn')
    expect((dialog.querySelector('[data-field="text"]') as HTMLInputElement).value).toBe('文档')
    wrapper.unmount()
  })
  it('正文气泡点「编辑」时带着地址打开弹窗，文字一并预填', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    const editor = wrapper.findComponent(MilkdownEditor)
    const exposed = editor.vm.$.exposed as {
      currentLink: () => { href: string; text: string } | null
    }
    vi.spyOn(exposed, 'currentLink').mockReturnValue({ href: 'https://a.cn', text: '文档' })

    editor.vm.$emit('edit-link', 'https://a.cn')
    await wrapper.vm.$nextTick()

    const dialog = document.querySelector('.link-dialog')!
    expect(dialog.textContent).toContain('编辑链接')
    expect((dialog.querySelector('[data-field="href"]') as HTMLInputElement).value).toBe('https://a.cn')
    expect((dialog.querySelector('[data-field="text"]') as HTMLInputElement).value).toBe('文档')
    wrapper.unmount()
  })

  it('编辑器的一次性提示走顶部 Toast，不再显示在底栏', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    wrapper.findComponent(MilkdownEditor).vm.$emit('notice', '已复制链接')
    await wrapper.vm.$nextTick()

    expect(notice.value).toBe('已复制链接')
    expect(wrapper.find('.share-notice').exists()).toBe(false)
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

  it('渲染剩余天数提示与恢复 / 彻底删除，不渲染编辑动作、字数、信息、历史与「⋯」', async () => {
    const { wrapper } = await mountTrashed()

    expect(wrapper.text()).toContain('此笔记还有 30 天被删除')
    expect(wrapper.find('.format-bar').exists()).toBe(false)
    expect(op(wrapper, 'recover').exists()).toBe(true)
    expect(op(wrapper, 'purge').exists()).toBe(true)
    for (const name of ['more', 'wordcount', 'info', 'history']) expect(op(wrapper, name).exists()).toBe(false)
    expect(menu()).toBeNull()
    expect(op(wrapper, 'top').exists()).toBe(false)
    expect(op(wrapper, 'trash').exists()).toBe(false)
    expect(op(wrapper, 'undo').exists()).toBe(false)
    expect(op(wrapper, 'redo').exists()).toBe(false)
    expect(op(wrapper, 'image').exists()).toBe(false)
    expect(wrapper.find('.editor-footer').exists()).toBe(false)
    wrapper.unmount()
  })

  it('服务端关闭自动清理时只说在回收站中；手机上同样没有「⋯」', async () => {
    const restore = mockCompact()
    try {
      const ui = useUiStore()
      ui.trashRetentionDays = null
      const { wrapper } = await mountTrashed()
      expect(wrapper.text()).toContain('此笔记在回收站中')
      expect(op(wrapper, 'more').exists()).toBe(false)
      wrapper.unmount()
    } finally {
      restore()
    }
  })

  it('正文可见但编辑器为只读', async () => {
    const { wrapper } = await mountTrashed()
    await flushPromises()

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

  it('彻底删除直接进入回收站，确认后物理删除笔记并清空当前选中', async () => {
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

describe('NoteDetail 把编辑器的基线交给 store', () => {
  it('update:modelValue 与 flush 都把基线一并传给 saveBody', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id
    const save = vi.spyOn(notes, 'saveBody').mockResolvedValue()

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()
    const editor = wrapper.findComponent(MilkdownEditor)
    editor.vm.$emit('update:modelValue', '新正文', '旧正文')
    editor.vm.$emit('flush', note.id, '切走前的正文', '新正文')

    // 少了基线，数据层就无法发现库里正文已被远端改写
    expect(save).toHaveBeenCalledWith(note.id, '新正文', '旧正文')
    expect(save).toHaveBeenCalledWith(note.id, '切走前的正文', '新正文')
    wrapper.unmount()
  })
})

describe('NoteDetail 阅读模式', () => {
  it('开启后编辑器只读、提示条出现、编辑工具收起，退出后恢复可编辑', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '要读的正文')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(wrapper.findComponent(MilkdownEditor).props('editable')).toBe(true)
    expect(wrapper.find('.format-bar').exists()).toBe(true)
    expect(wrapper.find('.reading-banner').exists()).toBe(false)

    await op(wrapper, 'reading').trigger('click')
    await wrapper.vm.$nextTick()

    expect(ui.readingMode).toBe(true)
    expect(wrapper.findComponent(MilkdownEditor).props('editable')).toBe(false)
    expect(wrapper.find('.format-bar').exists()).toBe(false)
    expect(wrapper.find('.reading-banner').exists()).toBe(true)
    // 编辑类按钮在阅读模式下不渲染；置顶/星标这类元信息仍可用
    for (const name of ['undo', 'redo', 'image', 'trash']) expect(op(wrapper, name).exists()).toBe(false)
    for (const name of ['star', 'top', 'more']) expect(op(wrapper, name).exists()).toBe(true)

    await wrapper.find('.reading-exit').trigger('click')
    await wrapper.vm.$nextTick()

    expect(ui.readingMode).toBe(false)
    expect(wrapper.findComponent(MilkdownEditor).props('editable')).toBe(true)
    expect(wrapper.find('.format-bar').exists()).toBe(true)
    wrapper.unmount()
  })

  it('进入阅读模式前先把编辑器里待保存的内容交出去', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    const exposed = wrapper.findComponent(MilkdownEditor).vm.$.exposed as { flush: () => void }
    const flush = vi.spyOn(exposed, 'flush')

    await op(wrapper, 'reading').trigger('click')

    // 少了这一步，debounce 中的最后几个字会被随后的只读判断挡掉
    expect(flush).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('快捷键请求（readingRequest）走同一条路径', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    ui.readingRequest += 1
    await wrapper.vm.$nextTick()
    expect(ui.readingMode).toBe(true)

    ui.readingRequest += 1
    await wrapper.vm.$nextTick()
    expect(ui.readingMode).toBe(false)
    wrapper.unmount()
  })

  it('阅读模式下删除快捷键不再弹确认', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    ui.readingMode = true
    await wrapper.vm.$nextTick()
    ui.trashRequest += 1
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.confirm-dialog').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('NoteDetail 首页信息流开关', () => {
  it('设为不上首页时保留原视图、选中笔记和正文', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '归档内容')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await openMore(wrapper)

    expect(menuAction('home-feed')!.textContent).toContain('不在首页信息流显示')
    menuAction('home-feed')!.click()
    // 等属性写入与列表刷新完成。
    await vi.waitFor(async () => {
      expect((await db.notes.get(note.id))!.home_hidden).toBe(1)
      expect(ui.view).toBe('all')
      expect(notes.current?.body).toBe('归档内容')
    })
    // 列表筛选照常生效，当前编辑内容继续保留。
    expect(notes.currentId).toBe(note.id)
    wrapper.unmount()
  })

  it('恢复首页显示时仍停留在原隐藏视图', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await db.notes.update(note.id, { home_hidden: 1 })
    ui.view = 'hidden'
    await notes.load()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await openMore(wrapper)

    expect(menuAction('home-feed')!.textContent).toContain('在首页信息流显示')
    menuAction('home-feed')!.click()
    await vi.waitFor(async () => {
      expect((await db.notes.get(note.id))!.home_hidden).toBe(0)
      expect(ui.view).toBe('hidden')
    })
    wrapper.unmount()
  })

  it('所属分组默认不上首页时，给出「恢复跟随分组设置」', async () => {
    const notes = useNotesStore()
    const groups = useGroupsStore()
    const group = await groups.create('归档')
    await groups.setHomeFeedHidden(group.group_id, true)
    const note = await notes.create()
    await notes.saveBody(note.id, '归档内容')
    await notes.setProps(note.id, { group_id: group.group_id })
    // 单独设过覆盖值，才有「跟随分组」可恢复
    await notes.setProps(note.id, { home_hidden: 0 })
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await openMore(wrapper)

    menuAction('home-follow')!.click()
    await vi.waitFor(async () => {
      expect((await db.notes.get(note.id))!.home_hidden).toBeNull()
    })
    wrapper.unmount()
  })
})

describe('顶栏的历史版本', () => {
  it('列出快照，点恢复后正文回到那一版且当前正文进入历史，Toast 提示已恢复', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '# 第一版')
    await notes.saveBody(note.id, '# 第二版')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await chooseMore(wrapper, 'history')
    await flushPromises()

    expect(document.querySelector('[role="dialog"][aria-label="历史版本"]')).not.toBeNull()
    const items = document.querySelectorAll('.history-item')
    expect(items).toHaveLength(1)
    expect(items[0].querySelector('.history-words')!.textContent).toContain('字')
    ;(items[0].querySelector('button[aria-expanded]') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('.history-preview')!.textContent).toBe('# 第一版')

    ;(document.querySelector('[data-op="restore"]') as HTMLButtonElement).click()
    await flushPromises()
    await vi.waitFor(() => expect(notes.current?.body).toBe('# 第一版'))
    await vi.waitFor(() => expect(document.querySelectorAll('.history-item')).toHaveLength(2))
    expect(notice.value).toContain('已恢复')
    wrapper.unmount()
  })
})

describe('顶栏的加入笔记本', () => {
  async function seedBook(name: string) {
    const book = await createKnowledgeBase({ name, description: '', icon: '', ord: 0, invalid: 0 })
    return book
  }

  /** Dexie 的 liveQuery 是批量推的，比 flushPromises 慢一拍；等到目标条件成立再断言 */
  const memberCount = (noteId: string) => db.knowledgeBaseTocs.toArray()
    .then(tocs => tocs.reduce((n, toc) => n + toc.nodes.filter(node => node.note_id === noteId).length, 0))

  it('没加入任何笔记本时显示入口，浮层把可加入的笔记本列出来', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id
    await seedBook('产品研究')

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await vi.waitFor(() => expect(op(wrapper, 'notebook').text()).toContain('加入笔记本'))

    await op(wrapper, 'notebook').trigger('click')
    // 列表要等 liveQuery 把索引数据推过来，所以等「可加入项」自己出现，再断言没有已加入项
    await vi.waitFor(() => expect(document.querySelector('.notebook-pop-addable .book-opt.addable')).not.toBeNull())
    const pop = document.querySelector('.notebook-pop')!
    expect(pop.querySelector('.notebook-pop-empty')!.textContent).toContain('还没加入任何笔记本')
    expect(pop.querySelectorAll('.notebook-pop-members .book-opt')).toHaveLength(0)
    expect(pop.querySelector('.notebook-pop-addable .book-opt.addable')!.textContent).toContain('产品研究')
    wrapper.unmount()
  })

  it('点可加入项后写入目录，入口显示笔记本名称且该项变成已加入', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id
    const book = await seedBook('产品研究')

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await vi.waitFor(() => expect(document.querySelector('.book-opt')).toBeNull())
    await op(wrapper, 'notebook').trigger('click')
    await vi.waitFor(() => expect(document.querySelector('.notebook-pop-addable .book-opt.addable')).not.toBeNull())
    ;(document.querySelector('.notebook-pop-addable .book-opt.addable') as HTMLButtonElement).click()

    await vi.waitFor(async () => expect(await memberCount(note.id)).toBe(1))
    await vi.waitFor(() => expect(op(wrapper, 'notebook').text()).toContain('产品研究'))
    await vi.waitFor(async () => {
      const toc = await db.knowledgeBaseTocs.get(book.id)
      expect(toc!.nodes.filter(n => n.note_id === note.id)).toHaveLength(1)
    })
    await vi.waitFor(() => expect(notice.value).toContain('已加入'))
    expect(useUiStore().view).toBe('knowledge-bases')
    expect(useUiStore().activeKnowledgeBaseId).toBe(book.id)
    expect(notes.currentId).toBe(note.id)
    await op(wrapper, 'notebook').trigger('click')
    await vi.waitFor(() => expect(document.querySelector('.notebook-pop-members')).not.toBeNull())
    expect(document.querySelector('.notebook-pop-addable')).toBeNull()
    expect(document.querySelector('[data-book-id="__new"]')).toBeNull()
    wrapper.unmount()
  })

  it('所属笔记本不再提供重复加入，删除进回收站且保留恢复位置', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id
    const book = await seedBook('产品研究')
    await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null })

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await vi.waitFor(() => expect(op(wrapper, 'notebook').text()).toContain('产品研究'))

    await op(wrapper, 'notebook').trigger('click')
    await flushPromises()
    const member = document.querySelector<HTMLButtonElement>('.notebook-pop-members .book-opt')!
    expect(member.textContent).toContain('产品研究')
    member.click()

    await flushPromises()
    expect(document.querySelector('.notebook-pop-addable')).toBeNull()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    await vi.waitFor(async () => expect((await db.notes.get(note.id))!.invalid).toBe(1))
    expect((await db.knowledgeBaseTocs.get(book.id))!.nodes).toHaveLength(1)
    expect(await db.outbox.where('kind').equals('trash').count()).toBe(1)
    wrapper.unmount()
  })

  it('窄屏顶栏放不下时，从「⋯」菜单进入同一个浮层', async () => {
    const restore = mockCompact()
    try {
      const notes = useNotesStore()
      const note = await notes.create()
      notes.currentId = note.id
      await seedBook('产品研究')

      const wrapper = mount(NoteDetail, { attachTo: document.body })
      await wrapper.vm.$nextTick()
      expect(op(wrapper, 'notebook').exists()).toBe(false)

      await openMore(wrapper)
      expect(menuAction('notebooks')!.textContent).toContain('加入笔记本')
      menuAction('notebooks')!.click()
      await flushPromises()
      expect(document.querySelector('.notebook-pop')).not.toBeNull()
      wrapper.unmount()
    } finally { restore() }
  })

  it('浮层里可以现场新建笔记本并立刻收录当前笔记', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await vi.waitFor(() => expect(op(wrapper, 'notebook').text()).toContain('加入笔记本'))
    await op(wrapper, 'notebook').trigger('click')
    await flushPromises()
    ;(document.querySelector('[data-book-id="__new"]') as HTMLButtonElement).click()
    await flushPromises()

    const form = document.querySelector<HTMLFormElement>('[role="dialog"][aria-label="新建笔记本"]')!
    expect(form).not.toBeNull()
    const name = form.querySelector<HTMLInputElement>('[aria-label="笔记本名称"]')!
    name.value = '读书笔记'
    name.dispatchEvent(new Event('input'))
    form.dispatchEvent(new Event('submit'))
    await flushPromises()

    await vi.waitFor(async () => {
      const book = (await db.knowledgeBases.toArray()).find(b => b.name === '读书笔记')
      expect(book).toBeTruthy()
      const toc = await db.knowledgeBaseTocs.get(book!.id)
      expect(toc!.nodes.filter(n => n.note_id === note.id)).toHaveLength(1)
    })
    await vi.waitFor(() => expect(notice.value).toContain('读书笔记'))
    wrapper.unmount()
  })
})
