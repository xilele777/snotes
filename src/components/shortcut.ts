export type ShortcutAction =
  | { type: 'create' }
  | { type: 'focusSearch' }
  | { type: 'clearQuery' }

/**
 * 解析键盘快捷键（UI 规格 §6.2）。
 * - Cmd/Ctrl + N → 新建笔记
 * - Cmd/Ctrl + F → 聚焦搜索框
 * - Esc → 仅在有活动查询时清空（无查询时不劫持，交给浏览器关闭弹层等默认行为）
 *
 * 只接收一个最小化的 event 形状与上下文，便于纯函数测试。
 */
export function resolveShortcut(
  e: { metaKey: boolean; ctrlKey: boolean; key: string },
  ctx: { hasQuery: boolean },
): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()

  if (mod && key === 'n') return { type: 'create' }
  if (mod && key === 'f') return { type: 'focusSearch' }
  if (key === 'escape' && ctx.hasQuery) return { type: 'clearQuery' }
  return null
}
