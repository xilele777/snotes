import type { DerivedFields } from './types'

export const TITLE_MAX = 64
export const SUMMARY_MAX = 120
export const IMAGE_URL_PREFIX = '/api/images/'

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g
/** 行首 ATX 标题标记。七个及以上井号不是标题，`#{1,6}` 后必须跟空白才算 */
const ATX_RE = /^\s{0,3}#{1,6}\s+/
const QUOTE_RE = /^\s{0,3}>\s?/
/** 行首列表标记：无序 - * +，有序 1. / 1) */
const BULLET_RE = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/
const EMPHASIS_RE = /[*_`~]/g

/**
 * 把一行 Markdown 剥成纯文字。
 * 图片整体丢弃（连 alt 一起），否则纯图笔记的标题会变成一整串 data:image/png;base64,…；
 * 链接只留可见文字。顺序不能乱：图片必须在链接之前处理，`![]()` 的后半段
 * 正好长得像一个链接，反过来会把图片拆成半截残留。
 */
function stripLine(line: string): string {
  return line
    .replace(ATX_RE, '')
    .replace(QUOTE_RE, '')
    .replace(BULLET_RE, '')
    .replace(IMAGE_RE, ' ')
    .replace(LINK_RE, '$1')
    .replace(EMPHASIS_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 把正文拆成「剥掉 Markdown 后仍有文字」的行序列。
 * 第一行给标题，其余给摘要——这是标题与摘要不重复的唯一依据，
 * 两者必须走同一份切分，否则会错位（比如标题跳过了纯图片行、摘要没跳）。
 */
function textLines(md: string): string[] {
  return md
    .split('\n')
    .map(stripLine)
    .filter((line) => line !== '')
}

/**
 * 标题取首个「剥掉 Markdown 后仍有文字」的行。
 * 不能直接取首个非空行：以图片开头的笔记会把整段 base64 当成标题。
 * 全文只有图片时返回空串，由调用方落到「无标题」。
 */
export function extractTitle(md: string): string {
  return (textLines(md)[0] ?? '').slice(0, TITLE_MAX)
}

/**
 * 摘要从标题的下一行起算。
 * 带上标题那行的话，列表里每条笔记的第二行都在复读第一行，
 * 只有一行内容的笔记更是标题摘要一模一样。没有下文就返回空串——
 * 摘要块的高度是钉死的，空着也不会让这一行比别人矮。
 */
export function extractSummary(md: string): string {
  return textLines(md).slice(1).join(' ').slice(0, SUMMARY_MAX)
}

export function extractThumbnail(md: string): string | null {
  for (const match of md.matchAll(IMAGE_RE)) {
    const url = match[1]
    if (url.startsWith(IMAGE_URL_PREFIX)) {
      return url.slice(IMAGE_URL_PREFIX.length)
    }
  }
  return null
}

export function derive(md: string): DerivedFields {
  // 切一次给两个字段用，别让 extractTitle / extractSummary 各扫一遍全文
  const lines = textLines(md)

  return {
    title: (lines[0] ?? '').slice(0, TITLE_MAX),
    summary: lines.slice(1).join(' ').slice(0, SUMMARY_MAX),
    thumbnail: extractThumbnail(md),
  }
}
