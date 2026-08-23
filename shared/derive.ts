import type { DerivedFields } from './types'

export const TITLE_MAX = 64
export const SUMMARY_MAX = 120
export const IMAGE_URL_PREFIX = '/api/images/'

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g

export function extractTitle(md: string): string {
  const line = md.split('\n').find((l) => l.trim() !== '')
  if (!line) return ''

  return line.trim().replace(/^#{1,6}\s+/, '').trim().slice(0, TITLE_MAX)
}

export function extractSummary(md: string): string {
  const text = md
    .replace(IMAGE_RE, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return text.slice(0, SUMMARY_MAX)
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
  return {
    title: extractTitle(md),
    summary: extractSummary(md),
    thumbnail: extractThumbnail(md),
  }
}
