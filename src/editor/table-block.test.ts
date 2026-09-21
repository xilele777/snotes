import { describe, expect, it } from 'vitest'
import { iconSvg, renderTableButton } from './table-block'

describe('table-block 图标', () => {
  it('每种按钮都渲染成内联 svg', () => {
    for (const type of ['add_row', 'add_col', 'delete_row', 'delete_col', 'align_col_left', 'align_col_center', 'align_col_right', 'col_drag_handle', 'row_drag_handle'] as const) {
      expect(renderTableButton(type)).toMatch(/^<svg[^>]*><path d="/)
    }
  })

  it('svg 使用 currentColor 描边，跟随按钮文字色', () => {
    expect(iconSvg('plus')).toContain('stroke="currentColor"')
  })
})
