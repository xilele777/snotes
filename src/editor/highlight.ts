import { $command, $inputRule, $markSchema, $remark, $useKeymap } from '@milkdown/kit/utils'
import { markRule } from '@milkdown/kit/prose'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { findAndReplace } from 'mdast-util-find-and-replace'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as MdastNode, Nodes, Parent, PhrasingContent } from 'mdast'
import type { Plugin } from 'unified'

/**
 * 高亮标记：`==文字==`。Markdown 没有官方语法，这个写法是 Obsidian、Typora 等常用的约定。
 * 解析时把文本节点里的 `==…==` 换成 `highlight` 节点，序列化时再拼回去，正文里存的仍是纯 Markdown。
 * 限制：高亮内部不再解析其他标记，`==**a**==` 里的星号按字面显示；反过来 `**==a==**` 可以。
 */
export const HIGHLIGHT_MARK = 'highlight'

interface HighlightNode extends Parent {
  type: 'highlight'
  children: PhrasingContent[]
}

/** 首尾不能是空白，避免 `== ==`、`====` 之类误伤 */
const HIGHLIGHT_PATTERN = /==([^\s=](?:[^=]*[^\s=])?)==/g

/** 输入规则用的版本：锚到行尾，输入完最后一个 = 时触发 */
export const HIGHLIGHT_INPUT_RULE = /(?<![\w=])(==)([^\s=](?:[^=]*[^\s=])?)\1(?!=)$/

export const remarkHighlight: Plugin<[], MdastNode> = function () {
  const self = this as unknown as { data: (key: string, value?: unknown) => unknown }
  const to = (self.data('toMarkdownExtensions') as unknown[] | undefined) ?? []
  self.data('toMarkdownExtensions', [
    ...to,
    {
      unsafe: [{ character: '=', inConstruct: 'phrasing', after: '=' }],
      handlers: {
        highlight: (node: HighlightNode, _parent: unknown, state: { containerPhrasing: (n: Parent, info: unknown) => string }, info: { before: string; after: string }) =>
          `==${state.containerPhrasing(node, { ...info, before: '=', after: '=' })}==`,
      },
    },
  ])
  return (tree) => {
    findAndReplace(tree as Nodes, [[
      HIGHLIGHT_PATTERN,
      (_match: string, inner: string) => ({ type: 'highlight', children: [{ type: 'text', value: inner }] } as unknown as PhrasingContent),
    ]])
  }
}

const highlightRemark = $remark('remarkHighlight', () => remarkHighlight as never)

export const highlightSchema = $markSchema(HIGHLIGHT_MARK, () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next((node as unknown as { children: Parameters<typeof state.next>[0] }).children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === HIGHLIGHT_MARK,
    runner: (state, mark) => {
      state.withMark(mark, 'highlight')
    },
  },
}))

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () => toggleMark(highlightSchema.type(ctx)))

export const highlightInputRule = $inputRule((ctx) => markRule(HIGHLIGHT_INPUT_RULE, highlightSchema.type(ctx)))

export const highlightKeymap = $useKeymap('highlightKeymap', {
  ToggleHighlight: {
    shortcuts: 'Mod-Shift-h',
    command: (ctx) => toggleMark(highlightSchema.type(ctx)),
  },
})

export const highlight: MilkdownPlugin[] = [highlightRemark, highlightSchema, toggleHighlightCommand, highlightInputRule, highlightKeymap].flat()
