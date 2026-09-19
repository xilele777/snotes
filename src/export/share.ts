import { safeName } from './backup'

/** 触发一次浏览器下载。a 元素必须挂进文档，Firefox 才会认这次点击。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 立刻 revoke 会让下载拿不到数据，留一点时间给浏览器把请求发出去
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 单条笔记导出时的文件名。 */
export function markdownFilename(title: string): string {
  return `${safeName(title)}.md`
}

export function downloadMarkdown(title: string, body: string): void {
  downloadBlob(new Blob([body], { type: 'text/markdown;charset=utf-8' }), markdownFilename(title))
}

/**
 * 复制正文。Clipboard API 只在安全上下文（https / localhost）可用，
 * 独立服务器用 http 访问时没有它，退回 textarea + execCommand。
 */
export async function copyMarkdown(body: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(body)
      return true
    }
  } catch {
    // 用户拒绝授权或页面不在前台，继续走兜底
  }

  try {
    const area = document.createElement('textarea')
    area.value = body
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'failed'

/**
 * 分享正文：手机端优先交给系统分享面板，不支持（或用户取消）时退回复制。
 * 取消分享按 copied 之外的结果处理即可——用户已经表达了不分享，不该再弹一次「已复制」。
 */
export async function shareMarkdown(title: string, body: string): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: body })
      return 'shared'
    } catch {
      // AbortError（用户取消）与 NotAllowedError 都落在复制兜底上
    }
  }
  return (await copyMarkdown(body)) ? 'copied' : 'failed'
}
