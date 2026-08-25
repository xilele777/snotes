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
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['b'])
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
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['abcd'])
  })

  it('内容与当前值相同时不 emit', async () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'same' },
    })

    wrapper.vm.onMarkdownChange('same')
    vi.advanceTimersByTime(1000)

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
    expect(wrapper.emitted('flush')![0]).toEqual(['n1', '属于 n1 的内容'])

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

    expect(wrapper.emitted('flush')![0]).toEqual(['n1', '还没到 800ms 就切走了'])
  })

  it('pagehide 时 flush，覆盖手机上直接切后台被系统杀掉的情况', () => {
    const wrapper = mount(MilkdownEditor, {
      props: { noteId: 'n1', modelValue: 'a' },
    })

    wrapper.vm.onMarkdownChange('半句话')
    window.dispatchEvent(new Event('pagehide'))

    expect(wrapper.emitted('flush')![0]).toEqual(['n1', '半句话'])
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
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['![](/api/images/n1/abc.jpg)'])
  })

})
