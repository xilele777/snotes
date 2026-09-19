import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyMarkdown, downloadMarkdown, markdownFilename, shareMarkdown } from './share'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('markdownFilename', () => {
  it('标题里的非法字符换成下划线并补上 .md', () => {
    expect(markdownFilename('会议/记录:2024')).toBe('会议_记录_2024.md')
    expect(markdownFilename('')).toBe('无标题.md')
  })
})

describe('copyMarkdown', () => {
  it('优先走 Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyMarkdown('# 正文')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('# 正文')
  })

  it('没有 Clipboard API（http 下的服务器部署）时退回 execCommand', async () => {
    vi.stubGlobal('navigator', {})
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec

    await expect(copyMarkdown('# 正文')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    // 兜底用的 textarea 用完要收掉，不能留在文档里
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('两条路都失败时返回 false，而不是抛错', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => { throw new Error('blocked') })

    await expect(copyMarkdown('# 正文')).resolves.toBe(false)
  })
})

describe('shareMarkdown', () => {
  it('支持系统分享时交给系统面板', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })

    await expect(shareMarkdown('标题', '正文')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: '标题', text: '正文' })
  })

  it('用户取消分享后退回复制，不会什么都不做', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await expect(shareMarkdown('标题', '正文')).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('正文')
  })
})

describe('downloadMarkdown', () => {
  it('用 a[download] 触发下载并把地址回收', () => {
    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadMarkdown('会议记录', '# 会议记录\n')

    expect(click).toHaveBeenCalled()
    const anchor = document.querySelector('a')
    expect(anchor).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled() // 交给定时器，等浏览器把请求发出去
  })
})
