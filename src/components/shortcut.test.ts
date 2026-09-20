import { describe, expect, it } from 'vitest'
import { resolveShortcut } from './shortcut'

const mod = (key: string) => ({ metaKey: true, ctrlKey: false, key })
const ctrl = (key: string) => ({ metaKey: false, ctrlKey: true, key })

describe('resolveShortcut', () => {
  it('Cmd/Ctrl + N → create', () => {
    expect(resolveShortcut(mod('n'), { hasQuery: false })).toEqual({ type: 'create' })
    expect(resolveShortcut(ctrl('n'), { hasQuery: false })).toEqual({ type: 'create' })
  })

  it('Cmd/Ctrl + F → focusSearch', () => {
    expect(resolveShortcut(mod('f'), { hasQuery: false })).toEqual({ type: 'focusSearch' })
  })

  it('Cmd/Ctrl + K → focusSearch', () => {
    expect(resolveShortcut(mod('k'), { hasQuery: false })).toEqual({ type: 'focusSearch' })
    expect(resolveShortcut(ctrl('k'), { hasQuery: false })).toEqual({ type: 'focusSearch' })
  })

  it('Esc 在有查询时 → clearQuery', () => {
    expect(resolveShortcut({ metaKey: false, ctrlKey: false, key: 'Escape' }, { hasQuery: true }))
      .toEqual({ type: 'clearQuery' })
  })

  it('Esc 在无查询时 → null（交给浏览器默认行为，不劫持）', () => {
    expect(resolveShortcut({ metaKey: false, ctrlKey: false, key: 'Escape' }, { hasQuery: false }))
      .toBeNull()
  })

  it('无修饰键的字母不触发任何快捷键', () => {
    expect(resolveShortcut({ metaKey: false, ctrlKey: false, key: 'n' }, { hasQuery: false })).toBeNull()
  })

  it('Shift+N 不算新建（避免与浏览器 Ctrl+Shift+N 冲突误判）', () => {
    // shift 不改变 key 的大小写时仍然返回 create；这里测的是无 cmd/ctrl 时不触发
    expect(resolveShortcut({ metaKey: false, ctrlKey: false, key: 'N' }, { hasQuery: false })).toBeNull()
  })

  it('大小写不敏感：Cmd+Shift+N 仍匹配', () => {
    expect(resolveShortcut({ metaKey: true, ctrlKey: false, key: 'N' }, { hasQuery: false }))
      .toEqual({ type: 'create' })
  })
})

describe('resolveShortcut 扩展键位', () => {
  const ctx = { hasQuery: false }
  const shift = (key: string, code?: string) => ({ metaKey: false, ctrlKey: true, shiftKey: true, key, code })
  const alt = (key: string) => ({ metaKey: false, ctrlKey: true, altKey: true, key })

  it('Mod+Shift+S/P/D → 星标、置顶、删除', () => {
    expect(resolveShortcut(shift('S'), ctx)).toEqual({ type: 'toggleStar' })
    expect(resolveShortcut(shift('p'), ctx)).toEqual({ type: 'togglePin' })
    expect(resolveShortcut(shift('D'), ctx)).toEqual({ type: 'trash' })
  })

  it('Mod+Shift+F 是专注模式而不是搜索', () => {
    expect(resolveShortcut(shift('F'), ctx)).toEqual({ type: 'toggleFocus' })
  })

  it('Mod+Shift+U → 立即同步', () => {
    expect(resolveShortcut(shift('U'), ctx)).toEqual({ type: 'syncNow' })
  })

  it('Mod+Alt+↑/↓ → 上一条 / 下一条', () => {
    expect(resolveShortcut(alt('ArrowDown'), ctx)).toEqual({ type: 'nextNote' })
    expect(resolveShortcut(alt('ArrowUp'), ctx)).toEqual({ type: 'prevNote' })
  })

  it('Mod+Shift+数字按物理键位识别，Shift 把 key 变成符号也不影响', () => {
    expect(resolveShortcut(shift(')', 'Digit0'), ctx)).toEqual({ type: 'showAll' })
    expect(resolveShortcut(shift('!', 'Digit1'), ctx)).toEqual({ type: 'showGroup', index: 0 })
    expect(resolveShortcut(shift('3', 'Digit3'), ctx)).toEqual({ type: 'showGroup', index: 2 })
  })

  it('没有 Shift 的 Mod+数字不抢浏览器切标签', () => {
    expect(resolveShortcut({ metaKey: false, ctrlKey: true, key: '1', code: 'Digit1' }, ctx)).toBeNull()
  })

  it('单独的 Alt+方向键不切笔记（编辑器里是按词移动光标）', () => {
    expect(resolveShortcut({ metaKey: false, ctrlKey: false, altKey: true, key: 'ArrowDown' }, ctx)).toBeNull()
  })
})
