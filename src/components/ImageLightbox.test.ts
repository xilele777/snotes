import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ImageLightbox from './ImageLightbox.vue'

const IMAGES = ['/api/images/a.jpg', '/api/images/b.jpg', '/api/images/c.jpg']

function mountBox(props: Partial<{ open: boolean; images: string[]; initialIndex: number }> = {}) {
  return mount(ImageLightbox, {
    props: { open: true, images: IMAGES, initialIndex: 0, ...props },
    attachTo: document.body,
  })
}

const shownSrc = () => document.querySelector<HTMLImageElement>('.lightbox-stage img')?.getAttribute('src')
const click = (op: string) => document.querySelector<HTMLButtonElement>(`[data-op="${op}"]`)!.click()

describe('ImageLightbox', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { document.body.innerHTML = '' })

  it('open 为 false 时不渲染', () => {
    const wrapper = mountBox({ open: false })
    expect(document.querySelector('.lightbox-mask')).toBeNull()
    wrapper.unmount()
  })

  it('打开时按 initialIndex 显示对应图片', () => {
    const wrapper = mountBox({ initialIndex: 1 })
    expect(document.querySelector('.lightbox-mask')).toBeTruthy()
    expect(shownSrc()).toBe('/api/images/b.jpg')
    wrapper.unmount()
  })

  it('左右切换在图片列表里前后走', async () => {
    const wrapper = mountBox({ initialIndex: 1 })

    click('prev')
    await wrapper.vm.$nextTick()
    expect(shownSrc()).toBe('/api/images/a.jpg')

    click('next')
    await wrapper.vm.$nextTick()
    expect(shownSrc()).toBe('/api/images/b.jpg')

    click('next')
    await wrapper.vm.$nextTick()
    expect(shownSrc()).toBe('/api/images/c.jpg')
    wrapper.unmount()
  })

  it('首尾禁用对应的切换按钮', async () => {
    const wrapper = mountBox({ initialIndex: 0 })
    expect(document.querySelector<HTMLButtonElement>('[data-op="prev"]')!.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[data-op="next"]')!.disabled).toBe(false)

    click('next')
    click('next')
    await wrapper.vm.$nextTick()
    expect(document.querySelector<HTMLButtonElement>('[data-op="next"]')!.disabled).toBe(true)
    wrapper.unmount()
  })

  it('多张图才显示计数，单张不显示', async () => {
    const wrapper = mountBox({ initialIndex: 1 })
    expect(document.querySelector('.lightbox-counter')?.textContent?.trim()).toBe('2 / 3')
    wrapper.unmount()

    const single = mountBox({ images: ['/api/images/only.jpg'] })
    expect(document.querySelector('.lightbox-counter')).toBeNull()
    single.unmount()
  })

  it('缩放改变图片的 transform，切换图片后归位', async () => {
    const wrapper = mountBox({ initialIndex: 0 })
    const img = () => document.querySelector<HTMLImageElement>('.lightbox-stage img')!

    expect(img().style.transform).toContain('scale(1)')

    click('zoom-in')
    await wrapper.vm.$nextTick()
    expect(img().style.transform).toContain('scale(1.25)')

    click('next')
    await wrapper.vm.$nextTick()
    expect(img().style.transform).toContain('scale(1)')
    wrapper.unmount()
  })

  it('缩放不低于 1 倍，避免图片缩到比屏幕还小', async () => {
    const wrapper = mountBox()
    click('zoom-out')
    click('zoom-out')
    await wrapper.vm.$nextTick()
    expect(document.querySelector<HTMLImageElement>('.lightbox-stage img')!.style.transform).toContain('scale(1)')
    wrapper.unmount()
  })

  it('适应屏幕把缩放和平移一起归零', async () => {
    const wrapper = mountBox()
    click('zoom-in')
    click('zoom-in')
    await wrapper.vm.$nextTick()
    click('fit')
    await wrapper.vm.$nextTick()
    const transform = document.querySelector<HTMLImageElement>('.lightbox-stage img')!.style.transform
    expect(transform).toContain('scale(1)')
    expect(transform).toContain('translate(0px, 0px)')
    wrapper.unmount()
  })

  it('键盘：左右切换、加减缩放、0 归位、Esc 关闭', async () => {
    const wrapper = mountBox({ initialIndex: 1 })
    const press = async (key: string) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))
      await wrapper.vm.$nextTick()
    }

    await press('ArrowRight')
    expect(shownSrc()).toBe('/api/images/c.jpg')

    await press('ArrowLeft')
    expect(shownSrc()).toBe('/api/images/b.jpg')

    await press('+')
    expect(document.querySelector<HTMLImageElement>('.lightbox-stage img')!.style.transform).toContain('scale(1.25)')

    await press('0')
    expect(document.querySelector<HTMLImageElement>('.lightbox-stage img')!.style.transform).toContain('scale(1)')

    await press('Escape')
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('点遮罩空白处关闭，点工具条不关', async () => {
    const wrapper = mountBox()

    document.querySelector<HTMLElement>('.lightbox-bar')!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeFalsy()

    document.querySelector<HTMLElement>('.lightbox-mask')!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('关闭按钮与下载按钮可用', async () => {
    const wrapper = mountBox()

    const clicked: string[] = []
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') el.click = () => clicked.push((el as HTMLAnchorElement).download)
      return el
    }) as typeof document.createElement)

    click('download')
    expect(clicked).toEqual(['a.jpg'])
    vi.restoreAllMocks()

    click('close')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })
})
