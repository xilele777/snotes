import { mount } from '@vue/test-utils'
import { shallowReactive } from 'vue'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { replaceAll } from '@milkdown/kit/utils'
import { uploadImage } from './image-upload'
import MilkdownEditor from './MilkdownEditor.vue'

const editorMock = vi.hoisted(() => ({ current: undefined as Editor | undefined }))
vi.mock('./image-upload', async (importOriginal) => ({
  ...await importOriginal<typeof import('./image-upload')>(),
  uploadImage: vi.fn(),
}))

vi.mock('@milkdown/vue', () => ({
  Milkdown: { template: '<div class="milkdown-mock" />' },
  MilkdownProvider: { template: '<div><slot /></div>' },
  useEditor: () => ({ loading: { value: false }, get: () => editorMock.current }),
}))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('MilkdownEditor 外壳', () => {
  it('挂载后不立即 emit', () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: '初始内容' },
    })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('内容变更后 800ms 才 emit 一次', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    wrapper.vm.onMarkdownChange('b')
    vi.advanceTimersByTime(799)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    vi.advanceTimersByTime(1)
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['b', 'a'])
  })

  it('连续输入只在停止 800ms 后 emit 最后一次', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    for (const text of ['ab', 'abc', 'abcd']) {
      wrapper.vm.onMarkdownChange(text)
      vi.advanceTimersByTime(300)
    }
    vi.advanceTimersByTime(800)

    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['abcd', 'a'])
  })

  it('内容与当前值相同时不 emit', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'same' },
    })

    wrapper.vm.onMarkdownChange('same')
    vi.advanceTimersByTime(1000)

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('暴露 insertImages 供顶栏文件选择器调用；编辑器未就绪时不抛错', () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    expect(typeof wrapper.vm.insertImages).toBe('function')
    expect(() => wrapper.vm.insertImages([new File(['x'], 'a.png', { type: 'image/png' })])).not.toThrow()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('切换 noteId 前先把上一条的待存内容 flush 出去，且带的是旧 id', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    wrapper.vm.onMarkdownChange('属于 n1 的内容')
    vi.advanceTimersByTime(200)

    await wrapper.setProps({ noteId: 'n2', modelValue: 'n2 的内容' })

    expect(wrapper.emitted('flush')).toHaveLength(1)
    expect(wrapper.emitted('flush')![0]).toEqual(['n1', '属于 n1 的内容', 'a'])

    // flush 过的内容不能再随 debounce 触发第二次
    vi.advanceTimersByTime(2000)
    expect(wrapper.emitted('flush')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('卸载时 flush 未触发的 debounce', () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    wrapper.vm.onMarkdownChange('还没到 800ms 就切走了')
    wrapper.unmount()

    expect(wrapper.emitted('flush')![0]).toEqual(['n1', '还没到 800ms 就切走了', 'a'])
  })

  it('pagehide 时 flush，覆盖手机上直接切后台被系统杀掉的情况', () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    wrapper.vm.onMarkdownChange('半句话')
    window.dispatchEvent(new Event('pagehide'))

    expect(wrapper.emitted('flush')![0]).toEqual(['n1', '半句话', 'a'])
  })
  it('含 blob: 占位的正文不 emit——避免死链落库或被同步推走', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    // 粘贴后编辑器先持有 blob: 占位，上传完成前这条 markdown 不该持久化
    wrapper.vm.onMarkdownChange('![](blob:https://example.com/abc)')
    vi.advanceTimersByTime(2000)

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('同一笔记收到远端正文时更新编辑器，不产生本地写入', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: '旧正文' },
    })
    const replace = vi.spyOn(wrapper.findComponent({ name: 'MilkdownInner' }).vm.$.exposed!, 'replaceContent')

    await wrapper.setProps({ modelValue: '远端新增内容' })
    vi.advanceTimersByTime(1000)

    expect(replace).toHaveBeenCalledWith('远端新增内容')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('本地保存回显不替换编辑器，保留光标与撤销历史', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: '旧正文' },
    })
    const replace = vi.spyOn(wrapper.findComponent({ name: 'MilkdownInner' }).vm.$.exposed!, 'replaceContent')
    wrapper.vm.onMarkdownChange('本机新正文')
    vi.advanceTimersByTime(800)

    await wrapper.setProps({ modelValue: '本机新正文' })

    expect(replace).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('本地保存的旧回显不能覆盖下一段尚未落库的输入', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: '初始正文' },
    })
    const replace = vi.spyOn(wrapper.findComponent({ name: 'MilkdownInner' }).vm.$.exposed!, 'replaceContent')
    wrapper.vm.onMarkdownChange('第一段')
    vi.advanceTimersByTime(800)
    wrapper.vm.onMarkdownChange('第一段和第二段')

    await wrapper.setProps({ modelValue: '第一段' })
    vi.advanceTimersByTime(800)

    expect(replace).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['第一段和第二段', '第一段'])
    wrapper.unmount()
  })

  it('blob: 占位换成真实 URL 后才 emit', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    wrapper.vm.onMarkdownChange('![](blob:https://example.com/abc)')
    vi.advanceTimersByTime(2000)

    // 上传完成，src 替换成真实地址，现在才落库
    wrapper.vm.onMarkdownChange('![](/api/images/n1/abc.jpg)')
    vi.advanceTimersByTime(2000)

    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['![](/api/images/n1/abc.jpg)', 'a'])
  })

})

describe('MilkdownEditor 基线上报', () => {
  it('emit 时附带这份内容改自哪一版正文', () => {
    const wrapper = mount(MilkdownEditor, { props: { noteId: 'n1', modelValue: '初始' } })

    wrapper.vm.onMarkdownChange('初始加一句')
    vi.advanceTimersByTime(800)

    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['初始加一句', '初始'])
  })

  it('连续两次保存，第二次的基线是第一次交出去的内容', () => {
    const wrapper = mount(MilkdownEditor, { props: { noteId: 'n1', modelValue: '初始' } })

    wrapper.vm.onMarkdownChange('第一段')
    vi.advanceTimersByTime(800)
    wrapper.vm.onMarkdownChange('第一段和第二段')
    vi.advanceTimersByTime(800)

    expect(wrapper.emitted('update:modelValue')![1]).toEqual(['第一段和第二段', '第一段'])
  })

  it('外部替换过内容后，基线换成替换进来的那一版', async () => {
    const wrapper = mount(MilkdownEditor, { props: { noteId: 'n1', modelValue: '初始' } })

    await wrapper.setProps({ modelValue: '远端正文' })
    wrapper.vm.onMarkdownChange('远端正文加一句')
    vi.advanceTimersByTime(800)

    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['远端正文加一句', '远端正文'])
    wrapper.unmount()
  })

  it('正在输入时收到远端正文：编辑器不替换，稍后保存仍带旧基线，交由数据层判定冲突', async () => {
    const wrapper = mount(MilkdownEditor, { props: { noteId: 'n1', modelValue: '初始' } })
    const replace = vi.spyOn(wrapper.findComponent({ name: 'MilkdownInner' }).vm.$.exposed!, 'replaceContent')

    wrapper.vm.onMarkdownChange('初始加本机的字')
    await wrapper.setProps({ modelValue: '远端改写的正文' })
    vi.advanceTimersByTime(800)

    expect(replace).not.toHaveBeenCalled()
    // 基线仍是「初始」而不是远端正文：这份内容确实不是从远端正文改出来的，
    // 数据层据此发现库里正文已被改写，把远端那版另存为冲突副本
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['初始加本机的字', '初始'])
    wrapper.unmount()
  })

  it('切换笔记后基线换成新笔记的正文', async () => {
    const wrapper = mount(MilkdownEditor, { props: { noteId: 'n1', modelValue: 'n1 正文' } })

    await wrapper.setProps({ noteId: 'n2', modelValue: 'n2 正文' })
    wrapper.vm.onMarkdownChange('n2 正文加一句')
    vi.advanceTimersByTime(800)

    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['n2 正文加一句', 'n2 正文'])
    wrapper.unmount()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function settleUpload() {
  // No sleeps or network: advance only the upload/preload promise continuations.
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('MilkdownEditor 上传的文档生命周期', () => {
  let editor: Editor
  const root = document.createElement('div')
  let wrapper: ReturnType<typeof mount<typeof MilkdownEditor>> | undefined
  let preloads: { onload: (() => void) | null; onerror: (() => void) | null; src: string; complete: boolean }[]
  let revoke: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    document.body.append(root)
    editor = await Editor.make().config(ctx => ctx.set(rootCtx, root)).use(commonmark).use(gfm).create()
  })
  afterAll(async () => { await editor.destroy(); root.remove() })
  beforeEach(() => {
    // Match @milkdown/vue's reactive editor exposure: status uses private fields.
    editorMock.current = shallowReactive(editor)
    editor.action(replaceAll('original'))
    vi.mocked(uploadImage).mockReset()
    let nextUrl = 0
    revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => `blob:test-${++nextUrl}`), revokeObjectURL: revoke,
    }))
    preloads = []
    vi.stubGlobal('Image', class {
      onload = null
      onerror = null
      src = ''
      complete = false
      constructor() { preloads.push(this) }
    })
    vi.stubGlobal('alert', vi.fn())
    wrapper = mount(MilkdownEditor, { props: { noteId: 'A', modelValue: 'original' } })
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    editorMock.current = undefined
    vi.unstubAllGlobals()
  })
  const file = () => new File(['image'], 'photo.png', { type: 'image/png' })
  function markdown() { return editor.action(ctx => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)) }

  it('two-file upload cannot insert its second placeholder into B, even after switching back to A', async () => {
    const upload = deferred<Awaited<ReturnType<typeof uploadImage>>>()
    vi.mocked(uploadImage).mockReturnValue(upload.promise)
    wrapper!.vm.insertImages([file(), file()])
    expect(uploadImage).toHaveBeenCalledExactlyOnceWith(expect.any(File), 'A')
    await wrapper!.setProps({ noteId: 'B', modelValue: 'B text' })
    await wrapper!.setProps({ noteId: 'A', modelValue: 'A reopened' })
    const action = vi.spyOn(editor, 'action')
    upload.resolve({ file_key: 'A/one.png', url: '/api/images/A/one.png' })
    await settleUpload()
    expect(action).not.toHaveBeenCalled()
    action.mockRestore()
    expect(markdown().trim()).toBe('A reopened')
    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(preloads).toHaveLength(0)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test-1')
  })

  it('switch during real-image preload does not mutate B and releases the placeholder exactly once', async () => {
    vi.mocked(uploadImage).mockResolvedValue({ file_key: 'A/one.png', url: '/api/images/A/one.png' })
    wrapper!.vm.insertImages([file(), file()])
    await settleUpload()
    expect(preloads).toHaveLength(1)
    expect(revoke).not.toHaveBeenCalled()
    const loaded = preloads[0]!.onload!
    await wrapper!.setProps({ noteId: 'B', modelValue: 'B text' })
    const action = vi.spyOn(editor, 'action')
    loaded()
    await settleUpload()
    expect(action).not.toHaveBeenCalled()
    action.mockRestore()
    expect(markdown().trim()).toBe('B text')
    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test-1')
  })

  it.each(['resolve', 'reject'] as const)('unmount during upload: late %s does not access the destroyed editor', async outcome => {
    const upload = deferred<Awaited<ReturnType<typeof uploadImage>>>()
    vi.mocked(uploadImage).mockReturnValue(upload.promise)
    wrapper!.vm.insertImages([file(), file()])
    wrapper!.unmount()
    wrapper = undefined
    const action = vi.spyOn(editor, 'action')
    if (outcome === 'resolve') upload.resolve({ file_key: 'A/one.png', url: '/api/images/A/one.png' })
    else upload.reject(new Error('late failure'))
    await settleUpload()
    expect(action).not.toHaveBeenCalled()
    action.mockRestore()
    expect(alert).not.toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test-1')
  })

  it('flushes text typed before and during an unresolved upload, with no blob image in valid nested Markdown', async () => {
    const upload = deferred<Awaited<ReturnType<typeof uploadImage>>>()
    vi.mocked(uploadImage).mockReturnValue(upload.promise)
    wrapper!.vm.onMarkdownChange('before upload')
    wrapper!.vm.insertImages([file()])
    const draft = 'before upload\n\n> - **during** ![alt](blob:test-1 "title") after\n\n[keep link](blob:link)\n\n`![](blob:code)`'
    editor.action(replaceAll(draft))
    // Deliberately do not deliver markdownUpdated: Milkdown debounces it 200ms.
    await wrapper!.setProps({ noteId: 'B', modelValue: 'B text' })
    const flushed = wrapper!.emitted('flush')![0]!
    expect(flushed[0]).toBe('A')
    expect(flushed[2]).toBe('original')
    expect(flushed[1]).toContain('before upload')
    expect(flushed[1]).toContain('**during**')
    expect(flushed[1]).toContain('after')
    expect(flushed[1]).not.toContain('blob:test-1')
    expect(flushed[1]).toContain('[keep link](blob:link)')
    expect(flushed[1]).toContain('`![](blob:code)`')
    editor.action(ctx => ctx.get(parserCtx)(flushed[1] as string).check())
    upload.resolve({ file_key: 'A/one.png', url: '/api/images/A/one.png' })
    await settleUpload()
    vi.advanceTimersByTime(2000)
    expect(wrapper!.emitted('update:modelValue')).toBeUndefined()
  })

  it.each(['flush', 'pagehide', 'unmount'] as const)('%s captures live text even before the Markdown listener runs', async exit => {
    const upload = deferred<Awaited<ReturnType<typeof uploadImage>>>()
    vi.mocked(uploadImage).mockReturnValue(upload.promise)
    wrapper!.vm.insertImages([file()])
    editor.action(replaceAll('unsaved before ![](blob:test-1) and during upload'))
    const current = wrapper!
    if (exit === 'flush') current.vm.flush()
    else if (exit === 'pagehide') window.dispatchEvent(new Event('pagehide'))
    else { current.unmount(); wrapper = undefined }
    const flushed = current.emitted('flush')![0]!
    expect(flushed[0]).toBe('A')
    expect(flushed[1]).toContain('unsaved before')
    expect(flushed[1]).toContain('and during upload')
    expect(flushed[1]).not.toContain('blob:')
    expect(flushed[2]).toBe('original')
    if (wrapper) { wrapper.unmount(); wrapper = undefined }
    upload.resolve({ file_key: 'A/one.png', url: '/api/images/A/one.png' })
    await settleUpload()
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test-1')
  })

  it('persists text while uploading, ignores its sanitized save echo, then persists the real URL', async () => {
    vi.mocked(uploadImage).mockResolvedValue({ file_key: 'A/one.png', url: '/api/images/A/one.png' })
    wrapper!.vm.insertImages([file()])
    wrapper!.vm.onMarkdownChange('typed ![](blob:test-1) tail')
    vi.advanceTimersByTime(800)
    const saved = wrapper!.emitted('update:modelValue')![0]![0] as string
    expect(saved).toContain('typed')
    expect(saved).toContain('tail')
    expect(saved).not.toContain('blob:')
    const replace = vi.spyOn(wrapper!.findComponent({ name: 'MilkdownInner' }).vm.$.exposed!, 'replaceContent')
    await wrapper!.setProps({ modelValue: saved })
    expect(replace).not.toHaveBeenCalled()
    await settleUpload()
    expect(revoke).not.toHaveBeenCalled()
    preloads[0]!.onload!()
    await settleUpload()
    expect(markdown()).toContain('/api/images/A/one.png')
    wrapper!.vm.onMarkdownChange('typed ![](/api/images/A/one.png) tail')
    vi.advanceTimersByTime(800)
    expect(wrapper!.emitted('update:modelValue')!.at(-1)![1]).toBe(saved)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test-1')
  })
})
