/** Vditor 4's undo snapshot restores a DOM Range even after the editor blurs.
 * Chromium focuses the contenteditable when that range is restored. Keep the
 * caret marker in history, but only restore the selection while editing. */
export function guardHistoryFocus(undo: { addCaret?: (state: unknown, setFocus?: boolean) => string }, isEditing: () => boolean) {
  const addCaret = undo.addCaret
  if (!addCaret) return
  undo.addCaret = function(state, setFocus = false) {
    return addCaret.call(this, state, setFocus && isEditing())
  }
}
