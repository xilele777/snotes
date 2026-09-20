import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import MilkdownEditor from '../editor/MilkdownEditor.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { dismissNotice, notice } from '../notify'
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

  it('五个动作全部摊在顶栏上，不用先点开菜单', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    for (const name of ['top', 'star', 'color', 'group', 'trash', 'more']) {
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

  it('编辑态顶栏有插入图片按钮，点击打开图片文件选择器', async () => {
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
    await op(wrapper, 'color').trigger('click')
    expect(wrapper.find('.op-popover.colors').exists()).toBe(true)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.op-popover.colors').exists()).toBe(false)
    wrapper.unmount()
  })

  it('没有底栏；桌面顶栏直接显示字数、文档信息、历史版本按钮', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '今天天气不错 hello')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.editor-footer').exists()).toBe(false)
    expect(op(wrapper, 'wordcount').text()).toContain('7 字')
    expect(op(wrapper, 'info').exists()).toBe(true)
    expect(op(wrapper, 'history').exists()).toBe(true)
    for (const name of ['share', 'help']) expect(op(wrapper, name).exists()).toBe(false)

    await op(wrapper, 'wordcount').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.wordcount-dialog')!.textContent).toContain('7')
    wrapper.unmount()
  })

  it('桌面「⋯」菜单只列复制、下载、打印；文档信息、历史、字数与删除都不在菜单里，首项获得焦点', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(menu()).toBeNull()
    await openMore(wrapper)

    expect(menu()).not.toBeNull()
    expect(op(wrapper, 'more').attributes('aria-expanded')).toBe('true')
    for (const name of ['copy', 'download', 'print']) expect(menuAction(name)).not.toBeNull()
    for (const name of ['info', 'history', 'wordcount', 'trash']) expect(menuAction(name)).toBeNull()
    // jsdom 没有 navigator.share，不给分享入口
    expect(menuAction('share')).toBeNull()
    expect(document.activeElement).toBe(menuAction('copy'))

    // Esc 关闭并把焦点还给 ⋯
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(op(wrapper, 'more').element)
    wrapper.unmount()
  })

  it('≤720px：顶栏没有删除、字数、信息、历史按钮，都进「⋯」菜单；删除先弹确认', async () => {
    const restore = mockCompact()
    try {
      const notes = useNotesStore()
      const note = await notes.create()
      notes.currentId = note.id

      const wrapper = mount(NoteDetail, { attachTo: document.body })
      await wrapper.vm.$nextTick()

      for (const name of ['trash', 'wordcount', 'info', 'history']) expect(op(wrapper, name).exists()).toBe(false)
      await openMore(wrapper)
      for (const name of ['info', 'history', 'wordcount', 'trash']) expect(menuAction(name)).not.toBeNull()
      menuAction('trash')!.click()
      await wrapper.vm.$nextTick()

      expect(menu()).toBeNull()
      expect(wrapper.find('.confirm-dialog').exists()).toBe(true)
      expect(notes.notes.find((n) => n.id === note.id)).toBeDefined()
      await wrapper.find('[data-op="confirm"]').trigger('click')
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
    await op(wrapper, 'info').trigger('click')
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

  it('快捷键请求（ui.trashRequest 自增）打开删除确认，只读态不响应', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    ui.trashRequest += 1
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.confirm-dialog').exists()).toBe(true)
    expect(wrapper.find('.dialog-title').text()).toBe('删除这条笔记？')
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
    const insertTable = vi.spyOn(exposed, 'insertTable').mockImplementation(() => {})

    await wrapper.find('[data-format="bold"]').trigger('click')
    await wrapper.find('[data-format="table"]').trigger('click')

    expect(format).toHaveBeenCalledWith('bold')
    expect(insertTable).toHaveBeenCalledTimes(1)
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

  it('渲染回收站提示与恢复 / 彻底删除，不渲染编辑动作；没有底栏', async () => {
    const { wrapper } = await mountTrashed()

    expect(wrapper.text()).toContain('此笔记在回收站中')
    expect(wrapper.find('.format-bar').exists()).toBe(false)
    expect(op(wrapper, 'recover').exists()).toBe(true)
    expect(op(wrapper, 'purge').exists()).toBe(true)
    expect(op(wrapper, 'more').exists()).toBe(true)
    expect(op(wrapper, 'top').exists()).toBe(false)
    expect(op(wrapper, 'trash').exists()).toBe(false)
    expect(op(wrapper, 'undo').exists()).toBe(false)
    expect(op(wrapper, 'redo').exists()).toBe(false)
    expect(op(wrapper, 'image').exists()).toBe(false)
    expect(wrapper.find('.editor-footer').exists()).toBe(false)
    expect(op(wrapper, 'history').exists()).toBe(true)
    wrapper.unmount()
  })

  it('只读态的「⋯」菜单没有分享与删除，仍有信息、历史、字数、复制、下载、打印', async () => {
    const restore = mockCompact()
    try {
      const { wrapper } = await mountTrashed()
      await openMore(wrapper)
      for (const name of ['info', 'history', 'wordcount', 'copy', 'download', 'print']) expect(menuAction(name)).not.toBeNull()
      expect(menuAction('share')).toBeNull()
      expect(menuAction('trash')).toBeNull()
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

describe('顶栏的历史版本', () => {
  it('列出快照，点恢复后正文回到那一版且当前正文进入历史，Toast 提示已恢复', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '# 第一版')
    await notes.saveBody(note.id, '# 第二版')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'history').trigger('click')
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

  it('回收站里只读：没有恢复按钮', async () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '# 第一版')
    await notes.saveBody(note.id, '# 第二版')
    await notes.trash(note.id)
    ui.view = 'trash'
    await notes.load()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { props: { readonly: true }, attachTo: document.body })
    await wrapper.vm.$nextTick()
    await op(wrapper, 'history').trigger('click')
    await flushPromises()

    expect(document.querySelectorAll('.history-item')).toHaveLength(1)
    expect(document.querySelector('[data-op="restore"]')).toBeNull()
    wrapper.unmount()
  })
})
