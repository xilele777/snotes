import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { clipboardImageFiles, isAllowedImage, uploadImage } from './image-upload'

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

const file = (type: string, size = 10, name = 'a') =>
  new File([new Uint8Array(size)], name, { type })

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

describe('clipboardImageFiles', () => {
  /** 构造与 DataTransferItem 形状一致的假 items：jsdom 没有 DataTransfer，这里按契约喂数据 */
  const itemOf = (f: File) => ({ getAsFile: () => f })
  const fakeDt = (files: File[]) => ({ items: files.map(itemOf) })

  it('从 items 取文件，同一张图只留一份', () => {
    const img = file('image/png', 20, 'a.png')

    // 浏览器里 items 与 files 是同一批文件的两个视图，item.getAsFile() 会重复暴露；
    // 从 items 单视图读，天然只有一份（Bug 1 修复点）
    expect(clipboardImageFiles(fakeDt([img]))).toHaveLength(1)
  })

  it('同一批 items 里元数据完全一致的两份文件，按元数据去重后只剩一份', () => {
    const a = file('image/png', 20, 'a.png')
    const b = file('image/png', 20, 'a.png') // 与 a 元数据完全一致

    expect(clipboardImageFiles(fakeDt([a, b]))).toHaveLength(1)
  })

  it('过滤掉非白名单类型与超限文件', () => {
    const files = [
      file('image/svg+xml', 20, 'evil.svg'),
      file('image/png', 10 * 1024 * 1024 + 1, 'huge.png'),
      file('image/webp', 30, 'ok.webp'),
    ]

    const res = clipboardImageFiles(fakeDt(files))
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('ok.webp')
  })

  it('没有 items（如纯文本剪贴板）时返回空数组', () => {
    expect(clipboardImageFiles(null)).toEqual([])
    expect(clipboardImageFiles({})).toEqual([])
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
