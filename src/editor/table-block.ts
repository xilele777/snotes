import { tableBlock as milkdownTableBlock, tableBlockConfig, type RenderType } from '@milkdown/kit/component/table-block'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { iconPaths, type IconName } from '../components/icons'

/** table-block 的按钮图标：与工具栏用同一套描边路径，风格一致 */
const ICON_BY_TYPE: Record<RenderType, IconName> = {
  add_row: 'plus',
  add_col: 'plus',
  delete_row: 'trash',
  delete_col: 'trash',
  align_col_left: 'alignLeft',
  align_col_center: 'alignCenter',
  align_col_right: 'alignRight',
  col_drag_handle: 'grip',
  row_drag_handle: 'grip',
}

export function iconSvg(name: IconName, size = 16): string {
  const paths = iconPaths[name].map((d) => `<path d="${d}" />`).join('')
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

export function renderTableButton(type: RenderType): string {
  return iconSvg(ICON_BY_TYPE[type])
}

/**
 * 表格操作 UI：加行加列、删行删列、列对齐、行列拖拽换位，都是 Milkdown 自带组件，
 * 这里只换成项目图标。Markdown 输出仍是 GFM 表格。
 */
export const tableBlock: MilkdownPlugin[] = [
  (ctx) => async () => {
    ctx.update(tableBlockConfig.key, (prev) => ({ ...prev, renderButton: renderTableButton }))
  },
  ...milkdownTableBlock,
]
