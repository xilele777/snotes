import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockVditor } from '../../tests/unit/mock-vditor'
import VditorEditor from './VditorEditor.vue'
import { uploadImage } from './image-upload'
import { loadVditorAssets } from './vditor-assets'

vi.mock('vditor', async () => ({ default: (await import('../../tests/unit/mock-vditor')).MockVditor }))
vi.mock('./vditor-assets', () => ({ loadVditorAssets: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./image-upload', async original => ({ ...await original<typeof import('./image-upload')>(), uploadImage: vi.fn() }))

const mounted: ReturnType<typeof mount>[] = []
async function create(body = '原文', editable = true) {
  const wrapper = mount(VditorEditor, { props: { noteId: 'a', modelValue: body, editable }, attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, editor: MockVditor.instances.at(-1)! }
}

beforeEach(() => { MockVditor.instances = []; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); localStorage.clear() })
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers(); vi.clearAllMocks() })

describe('Vditor 保存与同步边界', () => {
  it('初始化及只读切换保留 Vditor 的主题和全屏样式类', async () => {
    const { wrapper } = await create()
    const root = wrapper.get('.snotes-vditor')
    expect(root.classes()).toContain('vditor')
    expect(root.classes()).not.toContain('is-initializing')
    root.element.classList.add('vditor--dark', 'vditor--fullscreen')
    await wrapper.setProps({ editable: false })
    expect(root.classes()).toEqual(expect.arrayContaining(['vditor', 'vditor--dark', 'vditor--fullscreen', 'is-readonly']))
    await wrapper.setProps({ editable: true })
    expect(root.classes()).toEqual(expect.arrayContaining(['vditor', 'vditor--dark', 'vditor--fullscreen']))
    expect(root.classes()).not.toContain('is-readonly')
  })

  it('长文优先源码分屏，保留普通笔记的设备偏好且打开不改写正文', async () => {
    localStorage.setItem('snotes_editor_mode', 'ir')
    const value = '# 长文\n\n' + '正文段落。\n\n'.repeat(8000)
    const { wrapper, editor } = await create(value)
    expect(editor.options.mode).toBe('sv')
    expect(localStorage.getItem('snotes_editor_mode')).toBe('ir')
    expect(wrapper.find('.long-document-notice').text()).toContain('分屏模式')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(editor.value).toBe(value)
  })
  it('资源下载期间显示加载提示，切换后的最新正文在就绪后打开', async () => {
    let resolve!: () => void
    vi.mocked(loadVditorAssets).mockReturnValueOnce(new Promise<void>(done => { resolve = done }))
    const wrapper = mount(VditorEditor, { props: { noteId: 'a', modelValue: 'A' } })
    mounted.push(wrapper)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('A')
    expect(wrapper.get('.snotes-vditor').attributes('inert')).toBeDefined()
    expect(MockVditor.instances).toHaveLength(0)
    await wrapper.setProps({ noteId: 'b', modelValue: '最新正文' })
    resolve()
    await flushPromises()
    expect(MockVditor.instances.at(-1)?.value).toBe('最新正文')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('.snotes-vditor').classes()).not.toContain('is-initializing')
  })

  it('资源加载失败可重试，不把正文留在不可恢复的空白页', async () => {
    vi.mocked(loadVditorAssets).mockRejectedValueOnce(new Error('资源加载失败'))
    const wrapper = mount(VditorEditor, { props: { noteId: 'a', modelValue: '原文' } })
    mounted.push(wrapper)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('资源加载失败')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('ready')).toHaveLength(1)
    expect(MockVditor.instances.at(-1)?.value).toBe('原文')
  })
  it('打开和序列化规范化不写回，真实输入 800ms 后携带原始基线保存', async () => {
    const { wrapper, editor } = await create()
    vi.advanceTimersByTime(1000)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    editor.type('新正文')
    vi.advanceTimersByTime(799)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([['新正文', '原文']])
    await wrapper.setProps({ modelValue: '新正文' })
    expect(editor.setValue).not.toHaveBeenCalled()
  })

  it('切笔记读取最后一个按键，flush 带旧 id，并清空新文档撤销历史', async () => {
    const { wrapper, editor } = await create()
    editor.value = '还没触发 input 的最后一个字'
    await wrapper.setProps({ noteId: 'b', modelValue: '另一篇' })
    expect(wrapper.emitted('flush')).toEqual([['a', '还没触发 input 的最后一个字', '原文']])
    expect(editor.setValue).toHaveBeenLastCalledWith('另一篇', true)
    vi.advanceTimersByTime(2000)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('远端更新不覆盖还没触发 input 的本地输入，保留冲突基线', async () => {
    const { wrapper, editor } = await create()
    editor.value = '本地输入'
    await wrapper.setProps({ modelValue: '远端输入' })
    expect(editor.value).toBe('本地输入')
    vi.advanceTimersByTime(800)
    expect(wrapper.emitted('update:modelValue')).toEqual([['本地输入', '原文']])
  })

  it('无本地改动时接受远端更新，下一次编辑以远端正文为基线', async () => {
    const { wrapper, editor } = await create()
    await wrapper.setProps({ modelValue: '远端输入' })
    expect(editor.value).toBe('远端输入')
    editor.type('继续写')
    vi.advanceTimersByTime(800)
    expect(wrapper.emitted('update:modelValue')).toEqual([['继续写', '远端输入']])
  })

  it.each(['pagehide', 'unmount', 'readonly'])('%s 保存最后一次输入', async action => {
    const { wrapper, editor } = await create()
    editor.value = '最后输入'
    if (action === 'pagehide') window.dispatchEvent(new Event('pagehide'))
    if (action === 'unmount') wrapper.unmount()
    if (action === 'readonly') await wrapper.setProps({ editable: false })
    expect(wrapper.emitted('flush')).toEqual([['a', '最后输入', '原文']])
    if (action === 'readonly') {
      expect(editor.disabled).toHaveBeenCalled()
      expect(editor.updateToolbarConfig).toHaveBeenLastCalledWith({ hide: true, pin: true })
    }
  })

  it('异步初始化期间切换笔记，最终只加载最新笔记', async () => {
    const wrapper = mount(VditorEditor, { props: { noteId: 'a', modelValue: 'A' } })
    mounted.push(wrapper)
    await wrapper.setProps({ noteId: 'b', modelValue: 'B' })
    await flushPromises()
    const editor = MockVditor.instances.at(-1)!
    expect(editor.value).toBe('B')
    editor.type('编辑 B')
    wrapper.vm.flush()
    expect(wrapper.emitted('flush')).toEqual([['b', '编辑 B', 'B']])
  })

  it('挂载后立即卸载时安全释放异步创建的实例', async () => {
    const wrapper = mount(VditorEditor, { props: { noteId: 'a', modelValue: 'A' } })
    wrapper.unmount()
    await flushPromises()
    expect(MockVditor.instances).toHaveLength(0)
  })
})

describe('Vditor 图片与原生功能适配', () => {
  it.each([
    ['wysiwyg', false, false], ['wysiwyg', true, false], ['wysiwyg', false, true],
    ['ir', false, false], ['ir', true, false], ['ir', false, true],
    ['preview', false, false], ['readonly', false, false],
  ] as const)('%s 链接直接点击或带修饰键都打开规范化地址（Ctrl=%s，Meta=%s）', async (mode, ctrlKey, metaKey) => {
    const { wrapper } = await create('原文', mode !== 'readonly')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const root = wrapper.get('.snotes-vditor').element
    root.insertAdjacentHTML('beforeend', `<div class="vditor-reset ${mode === 'preview' ? 'vditor-preview' : ''}">${mode === 'ir'
      ? '<span data-type="a"><span>参考资料</span><span class="vditor-ir__marker--link">example.com</span></span>'
      : '<a href="example.com"><strong>参考资料</strong></a>'}</div>`)
    const link = root.querySelector('.vditor-reset strong, [data-type="a"] > span')!
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey, metaKey })
    try {
      link.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(true)
      expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com', '_blank', 'noopener,noreferrer')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    } finally { open.mockRestore() }
  })

  it.each(['javascript:alert(1)', 'data:text/html,test', 'java\nscript:alert(1)'])('链接点击不执行危险地址 %s', async href => {
    const { wrapper } = await create()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const content = document.createElement('div')
    content.className = 'vditor-reset'
    const link = document.createElement('a')
    link.setAttribute('href', href)
    content.append(link)
    wrapper.get('.snotes-vditor').element.append(content)
    try {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(true)
      expect(open).not.toHaveBeenCalled()
    } finally { open.mockRestore() }
  })

  it('上传结束后插入正式图片地址，正文中不出现临时地址', async () => {
    const { wrapper, editor } = await create()
    vi.mocked(uploadImage).mockResolvedValue({ file_key: 'i', url: '/api/images/i' })
    await wrapper.vm.insertImages([new File(['x'], 'a.png', { type: 'image/png' })])
    expect(uploadImage).toHaveBeenCalledWith(expect.any(File), 'a')
    expect(editor.insertMD).toHaveBeenCalledWith('![](<\/api/images/i>)')
    wrapper.vm.flush()
    expect(JSON.stringify(wrapper.emitted('flush'))).not.toContain('blob:')
  })

  it.each(['switch', 'remote', 'readonly', 'unmount'])('上传中 %s 后不往当前文档插入图片', async action => {
    const { wrapper, editor } = await create()
    let resolve!: (value: { file_key: string; url: string }) => void
    vi.mocked(uploadImage).mockReturnValue(new Promise(done => { resolve = done }))
    const uploading = wrapper.vm.insertImages([new File(['x'], 'a.png', { type: 'image/png' })])
    if (action === 'switch') await wrapper.setProps({ noteId: 'b', modelValue: 'B' })
    if (action === 'remote') await wrapper.setProps({ modelValue: '远端版本' })
    if (action === 'readonly') await wrapper.setProps({ editable: false })
    if (action === 'unmount') wrapper.unmount()
    resolve({ file_key: 'i', url: '/api/images/i' })
    await uploading
    expect(editor.insertMD).not.toHaveBeenCalled()
  })

  it('上传失败保留文字，拒绝不支持的文件', async () => {
    const { wrapper, editor } = await create()
    vi.mocked(uploadImage).mockRejectedValue(new Error('离线'))
    await wrapper.vm.insertImages([new File(['x'], 'a.png', { type: 'image/png' }), new File(['x'], 'a.pdf', { type: 'application/pdf' })])
    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(editor.value).toBe('原文')
    expect(wrapper.emitted('notice')).toHaveLength(2)
  })

  it('原生表格按钮先弹行列弹窗，禁用态保持原生行为', async () => {
    const { wrapper, editor } = await create()
    const root = wrapper.get('.snotes-vditor').element as HTMLElement
    root.insertAdjacentHTML('beforeend', '<div class="vditor-toolbar"><button data-type="table"></button><button data-type="table" class="vditor-menu--disabled"></button></div>')
    const [enabled, disabled] = root.querySelectorAll<HTMLButtonElement>('[data-type="table"]')

    disabled.click()
    await flushPromises()
    expect(document.querySelector('.table-dialog')).toBeNull()

    enabled.click()
    await flushPromises()
    expect(document.querySelector('.table-dialog')).not.toBeNull()
    expect(editor.insertMD).not.toHaveBeenCalled()

    const rows = document.querySelector<HTMLInputElement>('[data-field="rows"]')!
    const cols = document.querySelector<HTMLInputElement>('[data-field="cols"]')!
    rows.value = '4'
    rows.dispatchEvent(new Event('input'))
    cols.value = '2'
    cols.dispatchEvent(new Event('input'))
    document.querySelector<HTMLButtonElement>('[data-op="confirm"]')!.click()

    expect(editor.insertMD).toHaveBeenCalledWith('|  |  |\n| --- | --- |\n|  |  |\n|  |  |\n|  |  |')
  })

  it('关闭第二套正文缓存，资源同源，保留三种模式与扩展语法', async () => {
    localStorage.setItem('snotes_editor_mode', 'sv')
    const { editor } = await create()
    expect(editor.options.mode).toBe('sv')
    expect(editor.options.cache?.enable).toBe(false)
    expect(editor.options.cdn).toMatch(/^\/vendor\/vditor\/4\.0\.0$/)
    expect(editor.options.toolbar).toContain('edit-mode')
    expect(editor.options.toolbar).toContain('table')
    expect(editor.options.preview?.markdown).toMatchObject({ mark: true, toc: true, sanitize: true })
  })
})
