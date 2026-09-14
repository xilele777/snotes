import { orderedListSchema } from '@milkdown/kit/preset/commonmark'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'

/** Use HTML's default of 1: Number('') incorrectly turns an empty start into 0. */
export const orderedList = orderedListSchema.extendSchema(previous => ctx => ({
  ...previous(ctx),
  parseDOM: [{
    tag: 'ol',
    getAttrs: dom => ({
      spread: dom.dataset.spread === 'true',
      // The native getter handles missing/invalid values and preserves explicit starts, including 0.
      order: (dom as HTMLOListElement).start,
    }),
  }],
}))

/** A nested list starting above 1 (or at 0) needs a blank line after a paragraph in Markdown. */
export function configureListSerialization(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, options => ({
    ...options,
    join: [
      ...(options.join ?? []),
      (left, right) => {
        if (left.type === 'paragraph' && right.type === 'list' && right.ordered && (right.start ?? 1) !== 1) return 1
      },
    ],
  }))
}
