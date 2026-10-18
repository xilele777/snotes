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
  | { type: 'openSettings' }

export interface ShortcutEvent {
  metaKey: boolean
  ctrlKey: boolean
  key: string
  shiftKey?: boolean
  altKey?: boolean
  /** 物理键位；`,` 在部分键盘布局下 key 会变，靠 code 辨认 */
  code?: string
}

/** 设置「快捷键」页展示用的全局快捷键清单；Mod 由界面按平台替换成 Ctrl 或 ⌘ */
export const SHORTCUT_LIST: { keys: string; label: string }[] = [
  { keys: 'Alt N', label: '新建笔记' },
  { keys: 'Mod F', label: '搜索笔记' },
  { keys: 'Mod ,', label: '打开设置' },
  { keys: 'Mod Shift S', label: '星标 / 取消星标' },
  { keys: 'Mod Shift P', label: '置顶 / 取消置顶' },
  { keys: 'Mod Alt D', label: '删除当前笔记' },
  { keys: 'Mod Alt ↑ ↓', label: '上一条 / 下一条' },
  { keys: 'Mod Alt F', label: '专注模式' },
  { keys: 'Mod Alt U', label: '立即同步' },
]

/** 编辑器内的快捷键，由编辑器与灯箱自己处理，这里只用于展示 */
export const EDITOR_SHORTCUT_LIST: { keys: string; label: string }[] = [
  { keys: 'Mod E', label: '表情' },
  { keys: 'Mod H', label: '标题' },
  { keys: 'Mod Alt 1–6', label: '一级至六级标题' },
  { keys: 'Mod B', label: '加粗' },
  { keys: 'Mod I', label: '斜体' },
  { keys: 'Mod D', label: '删除线' },
  { keys: 'Mod K', label: '链接' },
  { keys: 'Mod L', label: '无序列表' },
  { keys: 'Mod O', label: '有序列表' },
  { keys: 'Mod J', label: '任务列表' },
  { keys: 'Mod Shift I', label: '减少缩进' },
  { keys: 'Mod Shift O', label: '增加缩进' },
  { keys: 'Mod ;', label: '引用' },
  { keys: 'Mod Shift H', label: '分割线' },
  { keys: 'Mod Alt H', label: '高亮' },
  { keys: 'Mod U', label: '代码块' },
  { keys: 'Mod G', label: '行内代码' },
  { keys: 'Mod Shift B', label: '在当前块前插入' },
  { keys: 'Mod Shift E', label: '在当前块后插入' },
  { keys: 'Mod M', label: '表格' },
  { keys: 'Mod Z', label: '撤销' },
  { keys: 'Mod Y', label: '重做' },
  { keys: 'Mod P', label: '双栏预览' },
  { keys: 'Mod Alt 7 / 8 / 9', label: '所见即所得 / 即时渲染 / 分屏预览' },
  { keys: 'Mod 点击链接', label: '在新标签打开链接' },
  { keys: '双击 / 长按图片', label: '打开灯箱' },
  { keys: '← →  + -  0  Esc', label: '灯箱内切换、缩放、复原、关闭' },
]

/** Markdown 速查：输入这些符号后编辑器会自动转成对应格式 */
export const MARKDOWN_HINTS: { keys: string; label: string }[] = [
  { keys: '# 空格', label: '标题' },
  { keys: '- 空格', label: '无序列表' },
  { keys: '1. 空格', label: '有序列表' },
  { keys: '> 空格', label: '引用' },
  { keys: '**文字**', label: '加粗' },
]

/**
 * 解析键盘快捷键（UI 规格 §6.2）。
 * - Alt + N → 新建笔记。Mod+N 是浏览器新窗口，页面拦不住；Ctrl+Alt 在 Windows 上等同 AltGr，
 *   常被输入法与键盘布局吃掉。Mac 上 Option+N 是死键，key 变成 Dead，靠 code 辨认。
 * - Cmd/Ctrl + F → 聚焦搜索框（编辑器外仍兼容 Mod+K）
 * - Cmd/Ctrl + , → 打开设置
 * - Esc → 仅在有活动查询时清空（无查询时不劫持，交给浏览器关闭弹层等默认行为）
 * - Cmd/Ctrl + Shift + S / P → 星标、置顶；Alt + D / U → 删除、同步
 * - Cmd/Ctrl + Alt + ↑ / ↓ → 列表里切到上一条 / 下一条（不用单独的 Alt+方向键，
 *   那在 Mac 编辑器里是按词移动光标）
 * - Cmd/Ctrl + Alt + F → 专注模式
 * - 不再占用 Mod+Shift+数字：与浏览器和系统输入法的快捷键冲突
 *
 * 只接收一个最小化的 event 形状与上下文，便于纯函数测试。
 */
export function resolveShortcut(
  e: ShortcutEvent,
  ctx: { hasQuery: boolean; inEditor?: boolean },
): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()

  if (mod && e.altKey && key === 'arrowdown') return { type: 'nextNote' }
  if (mod && e.altKey && key === 'arrowup') return { type: 'prevNote' }
  if (mod && e.altKey && !e.shiftKey) {
    if (key === 'd') return { type: 'trash' }
    if (key === 'u') return { type: 'syncNow' }
    if (key === 'f') return { type: 'toggleFocus' }
  }

  if (mod && e.shiftKey && !e.altKey) {
    if (key === 's') return { type: 'toggleStar' }
    if (key === 'p') return { type: 'togglePin' }
  }

  if (!mod && e.altKey && !e.shiftKey && (key === 'n' || e.code === 'KeyN')) return { type: 'create' }
  if (mod && !e.altKey && !e.shiftKey && (key === 'f' || (key === 'k' && !ctx.inEditor))) return { type: 'focusSearch' }
  if (mod && !e.shiftKey && !e.altKey && (key === ',' || e.code === 'Comma')) return { type: 'openSettings' }
  if (key === 'escape' && ctx.hasQuery) return { type: 'clearQuery' }
  return null
}
