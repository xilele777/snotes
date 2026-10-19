import { expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { archiveFilter, MAX_EXTRACTED_BYTES } from './archive'

it('rejects oversized declared ZIP contents before allocation and bounds cumulative expansion', () => {
  const filter = archiveFilter()
  const info = { name: 'a.md', size: 20, originalSize: 33 * 1024 * 1024, compression: 8 }
  expect(() => filter(info)).toThrow('解压后过大')
  const cumulative = archiveFilter()
  for (let i = 0; i < MAX_EXTRACTED_BYTES / (32 * 1024 * 1024); i++) cumulative({ ...info, name: `${i}.bin`, originalSize: 32 * 1024 * 1024 })
  expect(() => cumulative({ ...info, name: 'overflow', originalSize: 1 })).toThrow('解压后过大')
})

it('valid archives unpack, traversal and repeated paths are rejected', () => {
  const data = strToU8('# 笔记')
  expect(Array.from(unzipSync(zipSync({ 'notes/a.md': data }), { filter: archiveFilter() })['notes/a.md'])).toEqual(Array.from(data))
  expect(() => unzipSync(zipSync({ '../a.md': data }), { filter: archiveFilter() })).toThrow('无效或重复')
  const filter = archiveFilter()
  const info = { name: 'notes/a.md', size: 1, originalSize: 1, compression: 8 }
  filter(info)
  expect(() => filter({ ...info, name: 'notes\\a.md' })).toThrow('无效或重复')
})
