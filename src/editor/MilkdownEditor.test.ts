import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MilkdownEditor from './MilkdownEditor.vue'

vi.mock('@milkdown/vue', () => ({
  Milkdown: { template: '<div class="milkdown-mock" />' },
  MilkdownProvider: { template: '<div><slot /></div>' },
  useEditor: () => ({ loading: { value: false }, get: () => undefined }),
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
