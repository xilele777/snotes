import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import {
  isAllowedImage,
  removePlaceholder,
  replacePlaceholder,
  uploadImage,
} from './image-upload'

const apiUpload = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  apiUpload,
}))

// jsdom 没有 createImageBitmap 也没有 canvas，压缩整体换成恒等函数
vi.mock('./compress', () => ({
  MAX_EDGE: 1600,
  JPEG_QUALITY: 0.82,
  compressImage: (file: File) => Promise.resolve(file),
}))

beforeEach(() => {
  apiUpload.mockReset()
  apiUpload.mockResolvedValue({ file_key: 'n1/abc.jpg', url: '/api/images/n1/abc.jpg' })
})

const file = (type: string, size = 10) =>
  new File([new Uint8Array(size)], 'a', { type })

describe('isAllowedImage', () => {
  it('接受白名单内的四种格式', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(isAllowedImage(file(type))).toBe(true)
    }
  })

  it('拒绝 svg——它可以携带脚本', () => {
    expect(isAllowedImage(file('image/svg+xml'))).toBe(false)
  })

  it('拒绝非图片类型', () => {
    expect(isAllowedImage(file('application/pdf'))).toBe(false)
    expect(isAllowedImage(file('text/html'))).toBe(false)
  })

  it('拒绝超过 10 MB 的文件', () => {
    expect(isAllowedImage(file('image/png', 10 * 1024 * 1024 + 1))).toBe(false)
  })

  it('恰好 10 MB 可以接受', () => {
    expect(isAllowedImage(file('image/png', 10 * 1024 * 1024))).toBe(true)
  })
})

describe('replacePlaceholder', () => {
  it('把 blob 占位替换为正式 URL', () => {
    const md = '前文\n![](blob:http://x/abc)\n后文'

    expect(replacePlaceholder(md, 'blob:http://x/abc', '/api/images/k.jpg')).toBe(
      '前文\n![](/api/images/k.jpg)\n后文'
    )
  })

  it('只替换匹配的那一个占位', () => {
    const md = '![](blob:a) ![](blob:b)'

    expect(replacePlaceholder(md, 'blob:a', '/api/images/k.jpg')).toBe(
      '![](/api/images/k.jpg) ![](blob:b)'
    )
  })

  it('占位含正则元字符也能正确替换', () => {
    const md = '![](blob:http://x/a.b?c=1)'

    expect(replacePlaceholder(md, 'blob:http://x/a.b?c=1', '/api/images/k.jpg')).toBe(
      '![](/api/images/k.jpg)'
    )
  })

  it('找不到占位时原样返回', () => {
    expect(replacePlaceholder('![](blob:a)', 'blob:zzz', '/x')).toBe('![](blob:a)')
  })
})

describe('removePlaceholder', () => {
  it('连同前后的空行一起抹掉，不留死链', () => {
    const md = '前文\n\n![](blob:a)\n\n后文'

    // 留着占位的话，这条死链会随正文同步到其他设备，
    // 而 blob URL 只在当初那个页面上下文里有效，别处永远是一个破图标
    expect(removePlaceholder(md, 'blob:a')).toBe('前文\n\n后文')
  })

  it('只抹掉匹配的那一个', () => {
    expect(removePlaceholder('![](blob:a) ![](blob:b)', 'blob:a')).toBe('![](blob:b)')
  })

  it('找不到占位时原样返回', () => {
    expect(removePlaceholder('![](blob:a)', 'blob:zzz')).toBe('![](blob:a)')
  })
})

describe('uploadImage', () => {
  it('以 multipart 提交 file 与 note_id', async () => {
    await uploadImage(file('image/png'), 'note-1')

    expect(apiUpload).toHaveBeenCalledWith('/api/images/upload', expect.any(FormData))
    const form = apiUpload.mock.calls[0][1] as FormData
    expect(form.get('note_id')).toBe('note-1')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('返回 file_key 与同源 url', async () => {
    const result = await uploadImage(file('image/png'), 'note-1')

    expect(result).toEqual({ file_key: 'n1/abc.jpg', url: '/api/images/n1/abc.jpg' })
  })

  it('拒绝的类型直接抛错，不发请求', async () => {
    await expect(uploadImage(file('image/svg+xml'), 'n1')).rejects.toThrow()
    expect(apiUpload).not.toHaveBeenCalled()
  })

  it('服务端报错时向上抛出，由调用方保留占位', async () => {
    apiUpload.mockRejectedValue(new ApiError(500, 'boom'))

    await expect(uploadImage(file('image/png'), 'n1')).rejects.toBeInstanceOf(ApiError)
  })
})
