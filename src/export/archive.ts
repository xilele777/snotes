import type { UnzipFileInfo } from 'fflate'

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
export const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
const MAX_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 10_000

/** fflate 在分配解压缓冲前调用 filter，避免高压缩率输入撑爆内存。 */
export function archiveFilter() {
  let total = 0
  let count = 0
  const paths = new Set<string>()
  return (file: UnzipFileInfo): boolean => {
    const path = file.name.replace(/\\/g, '/')
    if (++count > MAX_ENTRIES) throw new Error('备份包含过多文件（最多 10000 个）')
    if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..') || paths.has(path)) {
      throw new Error('备份包含无效或重复的文件路径')
    }
    paths.add(path)
    total += file.originalSize
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || file.originalSize > MAX_ENTRY_BYTES || total > MAX_EXTRACTED_BYTES) {
      throw new Error('备份解压后过大：单文件最多 32 MiB，总计最多 256 MiB')
    }
    return true
  }
}
