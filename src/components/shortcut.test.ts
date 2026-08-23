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
