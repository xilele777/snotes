export type ShortcutAction =
  | { type: 'create' }
  | { type: 'focusSearch' }
  | { type: 'clearQuery' }
  | { type: 'toggleStar' }
  | { type: 'togglePin' }
  | { type: 'trash' }
  | { type: 'nextNote' }
  | { type: 'prevNote' }
  | { type: 'toggleFocus' }
  | { type: 'syncNow' }
  | { type: 'showAll' }
  | { type: 'showGroup'; index: number }

export interface ShortcutEvent {
  metaKey: boolean
  ctrlKey: boolean
  key: string
  shiftKey?: boolean
  altKey?: boolean
  /** 物理键位；Shift+数字在多数键盘上 key 会变成符号，只能靠 code 辨认 */
  code?: string
}

/** 「格式帮助」弹层里展示用的快捷键清单；Mod 由界面按平台替换成 Ctrl 或 ⌘ */
export const SHORTCUT_LIST: { keys: string; label: string }[] = [
  { keys: 'Mod N', label: '新建笔记' },
  { keys: 'Mod K', label: '搜索' },
  { keys: 'Mod Shift S', label: '星标 / 取消星标' },
  { keys: 'Mod Shift P', label: '置顶 / 取消置顶' },
  { keys: 'Mod Shift D', label: '删除当前笔记' },
  { keys: 'Mod Alt ↑ ↓', label: '上一条 / 下一条' },
  { keys: 'Mod Shift F', label: '专注模式' },
  { keys: 'Mod Shift U', label: '立即同步' },
  { keys: 'Mod Shift 0', label: '全部笔记' },
  { keys: 'Mod Shift 1–9', label: '第 N 个分组' },
]

/**
 * 解析键盘快捷键（UI 规格 §6.2）。
 * - Cmd/Ctrl + N → 新建笔记
 * - Cmd/Ctrl + K / F → 聚焦搜索框
 * - Esc → 仅在有活动查询时清空（无查询时不劫持，交给浏览器关闭弹层等默认行为）
 * - Cmd/Ctrl + Shift + S / P / D → 星标、置顶、删除当前笔记
 * - Cmd/Ctrl + Alt + ↑ / ↓ → 列表里切到上一条 / 下一条（不用单独的 Alt+方向键，
 *   那在 Mac 编辑器里是按词移动光标）
 * - Cmd/Ctrl + Shift + F → 专注模式；Cmd/Ctrl + Shift + U → 立即同步
 * - Cmd/Ctrl + Shift + 0 → 全部笔记；Cmd/Ctrl + Shift + 1–9 → 第 N 个分组
 *   （不带 Shift 的 Mod+数字是浏览器切标签，不能抢）
 *
 * 只接收一个最小化的 event 形状与上下文，便于纯函数测试。
 */
export function resolveShortcut(
  e: ShortcutEvent,
  ctx: { hasQuery: boolean },
): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()

  if (mod && e.altKey && key === 'arrowdown') return { type: 'nextNote' }
  if (mod && e.altKey && key === 'arrowup') return { type: 'prevNote' }

  if (mod && e.shiftKey) {
    if (key === 's') return { type: 'toggleStar' }
    if (key === 'p') return { type: 'togglePin' }
    if (key === 'd') return { type: 'trash' }
    if (key === 'f') return { type: 'toggleFocus' }
    if (key === 'u') return { type: 'syncNow' }
    const byCode = /^Digit(\d)$/.exec(e.code ?? '')?.[1]
    const digit = byCode ?? (/^\d$/.test(e.key) ? e.key : null)
    if (digit === '0') return { type: 'showAll' }
    if (digit) return { type: 'showGroup', index: Number(digit) - 1 }
  }

  if (mod && key === 'n') return { type: 'create' }
  if (mod && (key === 'f' || key === 'k')) return { type: 'focusSearch' }
  if (key === 'escape' && ctx.hasQuery) return { type: 'clearQuery' }
  return null
}
