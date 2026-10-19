import { describe, expect, it } from 'vitest'
import { tableMarkdown } from './table'

describe('tableMarkdown', () => {
  it('默认 3 行 3 列，表头、分隔行和两行正文', () => {
    expect(tableMarkdown(3, 3)).toBe(
      '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |',
    )
  })

  it('行数含表头，列数决定每行单元格数量', () => {
    const lines = tableMarkdown(2, 5).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0].split('|')).toHaveLength(7)
    expect(lines[1]).toContain('---')
    expect(lines[2].split('|')).toHaveLength(7)
  })

  it('只有表头时仍是合法表格', () => {
    expect(tableMarkdown(1, 2)).toBe('|  |  |\n| --- | --- |')
  })
})
