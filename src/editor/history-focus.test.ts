import { describe, expect, it, vi } from 'vitest'
import { guardHistoryFocus } from './history-focus'

describe('撤销快照的选区恢复', () => {
  it('焦点离开正文后继续保存光标标记，但不恢复正文选区', () => {
    let editing = true
    const state = {}
    const addCaret = vi.fn(function(this: unknown, _state: unknown, setFocus = false) {
      expect(this).toBe(undo)
      return setFocus ? 'focused<wbr>' : 'saved<wbr>'
    })
    const undo = { addCaret }
    guardHistoryFocus(undo, () => editing)
    expect(undo.addCaret(state, true)).toBe('focused<wbr>')
    editing = false
    expect(undo.addCaret(state, true)).toBe('saved<wbr>')
    expect(addCaret).toHaveBeenLastCalledWith(state, false)
    editing = true
    expect(undo.addCaret(state, false)).toBe('saved<wbr>')
  })
})
