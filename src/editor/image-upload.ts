import { apiUpload } from '../api/client'
import { compressImage } from './compress'

export const MAX_BYTES = 10 * 1024 * 1024

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function isAllowedImage(file: File): boolean {
  return ALLOWED.has(file.type) && file.size <= MAX_BYTES
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function replacePlaceholder(markdown: string, placeholder: string, url: string): string {
  return markdown.replace(new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(placeholder)}\\)`), `![$1](${url})`)
}

/** 上传失败时把占位整段抹掉，包括它前后多余的空行 */
export function removePlaceholder(markdown: string, placeholder: string): string {
  return markdown.replace(
    new RegExp(`\\n*!\\[[^\\]]*\\]\\(${escapeRegExp(placeholder)}\\)[ \\t]*\\n*`),
    (match) => (match.startsWith('\n') && match.endsWith('\n') ? '\n\n' : '')
  )
}

export async function uploadImage(
  file: File,
  noteId: string
): Promise<{ file_key: string; url: string }> {
  if (!isAllowedImage(file)) {
    throw new Error(`不支持的图片：${file.type}`)
  }

  const compressed = await compressImage(file)

  const form = new FormData()
  form.append('file', compressed, file.name)
  form.append('note_id', noteId)

  return apiUpload<{ file_key: string; url: string }>('/api/images/upload', form)
}
