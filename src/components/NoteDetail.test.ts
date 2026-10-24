import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { addKnowledgeBaseNode, createKnowledgeBase } from '../db/knowledge-base-repo'
import VditorEditor from '../editor/VditorEditor.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { dismissNotice, notice, runNoticeAction } from '../notify'
import NoteDetail from './NoteDetail.vue'
import { discardDraft, unsavedDrafts } from '../editor/save-session'

// Vditor 的真实 DOM 与解析器由浏览器测试覆盖。
vi.mock('vditor', async () => ({ default: (await import('../../tests/unit/mock-vditor')).MockVditor }))
vi.mock('../editor/vditor-assets', () => ({ loadVditorAssets: vi.fn().mockResolvedValue(undefined) }))

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
  if (op(wrapper, action).exists()) { await op(wrapper, action).trigger('click'); return }
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

  it('字数与历史直接可达，文档信息保留在菜单', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    await notes.saveBody(note.id, '今天天气不错 hello')
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.editor-footer').exists()).toBe(false)
    expect(op(wrapper, 'wordcount').exists()).toBe(true)
    await chooseMore(wrapper, 'wordcount')
    expect(document.querySelector('.wordcount-dialog')!.textContent).toContain('7')
    wrapper.unmount()
  })

  it('桌面菜单保留低频动作，常用入口移出且首项获得焦点', async () => {
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
    for (const name of ['color', 'info', 'trash']) expect(menuAction(name)).not.toBeNull()
    for (const name of ['notebooks', 'history', 'wordcount']) expect(menuAction(name)).toBeNull()
    // jsdom 没有 navigator.share，不给分享入口
    expect(menuAction('share')).toBeNull()
    expect(document.activeElement).toBe(menuAction('color'))

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
    expect((await db.bodies.get(original.id))!.body).toBe('# 原笔记\n\n保留正文')
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

describe('NoteDetail 编辑器提示', () => {
  it('编辑器的一次性提示走顶部 Toast，不再显示在底栏', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()

    wrapper.findComponent(VditorEditor).vm.$emit('notice', '已复制链接')
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

    const editor = wrapper.findComponent(VditorEditor)
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
  it('本地保存失败可见，重试提交最新草稿，成功前不会清掉恢复记录', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id
    const save = vi.spyOn(notes, 'saveBody').mockRejectedValue(new Error('QuotaExceededError'))
    const wrapper = mount(NoteDetail, { attachTo: document.body })
    try {
      await flushPromises()
      const editor = wrapper.findComponent(VditorEditor)
      editor.vm.$emit('update:modelValue', '第一份未保存正文', '')
      await flushPromises()
      expect(notice.value).toContain('本地保存失败')
      editor.vm.$emit('update:modelValue', '失败后继续写的最新正文', '第一份未保存正文')
      await flushPromises()
      expect(unsavedDrafts.value.find(d => d.id === note.id)?.body).toBe('失败后继续写的最新正文')
      save.mockResolvedValue()
      await runNoticeAction()
      expect(save).toHaveBeenLastCalledWith(note.id, '失败后继续写的最新正文', '')
      expect(unsavedDrafts.value.some(d => d.id === note.id)).toBe(false)
    } finally {
      wrapper.unmount()
      for (const draft of [...unsavedDrafts.value]) discardDraft(draft.journalKey)
      save.mockRestore()
    }
  })
  it('update:modelValue 与 flush 都把基线一并传给 saveBody', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id
    const save = vi.spyOn(notes, 'saveBody').mockResolvedValue()

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    await flushPromises()
    const editor = wrapper.findComponent(VditorEditor)
    editor.vm.$emit('update:modelValue', '新正文', '旧正文')
    editor.vm.$emit('flush', note.id, '切走前的正文', '新正文')

    // 同一笔记的保存串行执行；后一份输入必须等前一份确认后落库。
    await flushPromises()

    // 少了基线，数据层就无法发现库里正文已被远端改写
    expect(save).toHaveBeenCalledWith(note.id, '新正文', '旧正文')
    expect(save).toHaveBeenCalledWith(note.id, '切走前的正文', '新正文')
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
      expect(notes.currentBody).toBe('归档内容')
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
    await vi.waitFor(() => expect(notes.currentBody).toBe('# 第一版'))
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

  it('桌面笔记本入口直接打开浮层，列出可加入的笔记本', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    notes.currentId = note.id
    await seedBook('产品研究')

    const wrapper = mount(NoteDetail, { attachTo: document.body })
    await chooseMore(wrapper, 'notebooks')
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
    await chooseMore(wrapper, 'notebooks')
    await vi.waitFor(() => expect(document.querySelector('.notebook-pop-addable .book-opt.addable')).not.toBeNull())
    ;(document.querySelector('.notebook-pop-addable .book-opt.addable') as HTMLButtonElement).click()

    await vi.waitFor(async () => expect(await memberCount(note.id)).toBe(1))
    await vi.waitFor(() => expect(op(wrapper, 'notebooks').attributes('title')).toContain('已加入 1 本'))
    await vi.waitFor(async () => {
      const toc = await db.knowledgeBaseTocs.get(book.id)
      expect(toc!.nodes.filter(n => n.note_id === note.id)).toHaveLength(1)
    })
    await vi.waitFor(() => expect(notice.value).toContain('已加入'))
    expect(useUiStore().view).toBe('knowledge-bases')
    expect(useUiStore().activeKnowledgeBaseId).toBe(book.id)
    expect(notes.currentId).toBe(note.id)
    await chooseMore(wrapper, 'notebooks')
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
    await vi.waitFor(() => expect(op(wrapper, 'notebooks').attributes('title')).toContain('已加入 1 本'))
    await chooseMore(wrapper, 'notebooks')
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
    await chooseMore(wrapper, 'notebooks')
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
