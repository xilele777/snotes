/** 行列上限：再大在手机上既画不下也没人手填，需要更大的表格直接贴 Markdown */
export const TABLE_MIN = 1
export const TABLE_MAX = 20

/**
 * 生成 GFM 表格。行数含表头行，与表格弹窗的尺寸约定一致。
 * 单元格留空，插入后由用户直接填写。
 */
export function tableMarkdown(rows: number, cols: number): string {
  const row = (text: string) => `|${Array.from({ length: cols }, () => ` ${text} `).join('|')}|`
  const lines = [row(''), `|${Array.from({ length: cols }, () => ' --- ').join('|')}|`]
  for (let i = 1; i < rows; i++) lines.push(row(''))
  return lines.join('\n')
}
