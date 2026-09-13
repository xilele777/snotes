import type { Node } from '@milkdown/kit/prose/model'
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** GFM stores checked state; these native inputs make it usable with a mouse or keyboard. */
function decorate(doc: Node): DecorationSet {
  const widgets: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'list_item' || typeof node.attrs.checked !== 'boolean') return

    widgets.push(Decoration.widget(pos + 1, (view, getPos) => {
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.className = 'task-checkbox'
      checkbox.checked = node.attrs.checked
      checkbox.disabled = !view.editable
      checkbox.setAttribute('aria-label', `${checkbox.checked ? '标记为未完成' : '标记为完成'}：${node.textContent.slice(0, 80)}`)
      checkbox.addEventListener('change', () => {
        const position = getPos()
        if (position === undefined || !view.editable) return
        const item = view.state.doc.nodeAt(position - 1)
        if (item?.type.name !== 'list_item' || typeof item.attrs.checked !== 'boolean') return
        view.dispatch(view.state.tr.setNodeMarkup(position - 1, undefined, {
          ...item.attrs,
          checked: checkbox.checked,
        }))
        view.focus()
      })
      return checkbox
    }, { side: -1, stopEvent: () => true, ignoreSelection: true }))
  })
  return DecorationSet.create(doc, widgets)
}

export const taskCheckboxes = $prose(() => new Plugin<DecorationSet>({
  state: {
    init: (_, state) => decorate(state.doc),
    apply: (tr, previous) => tr.docChanged ? decorate(tr.doc) : previous,
  },
  props: {
    decorations(state) { return this.getState(state) },
  },
}))
