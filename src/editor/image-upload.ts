import { apiUpload } from '../api/client'
import { compressImage } from './compress'

export const MAX_BYTES = 10 * 1024 * 1024

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function isAllowedImage(file: File): boolean {
  return ALLOWED.has(file.type) && file.size <= MAX_BYTES
}

/**
 * 从剪贴板的 items 里取图片文件。
 * 只读 `data.items`：`data.files` 是 `items` 的子集视图，同一张图经两条路取出来
 * 往往是两个 File 对象且元数据对不上（files 视图 name 常为空、lastModified=0），
 * 按元数据去重会静默失效 → 同一张图被取两次、上传两次。从源头只读一个视图，
 * 再按元数据做防御性去重（兜底同一 DataTransfer 里被重复 add 的 item）。
 *
 * items 只用到 getAsFile，用 Iterable<{getAsFile}> 表达：真实 DataTransferItemList
 * 迭代出的元素就是这个形状，单测里喂假 items 也过得去，不必依赖 jsdom 提供 DataTransfer。
 */
export function clipboardImageFiles(data: { items?: Iterable<{ getAsFile(): File | null }> } | null): File[] {
  const files = Array.from(data?.items ?? [])
    .map((item) => item.getAsFile())
    .filter((f): f is File => f !== null)

  const seen = new Set<string>()
  return files.filter((file) => {
    if (!isAllowedImage(file)) return false

    const key = `${file.name}|${file.size}|${file.lastModified}|${file.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
