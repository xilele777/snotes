<script setup lang="ts">
import { commandsCtx, Editor, defaultValueCtx, editorStateCtx, editorViewCtx, editorViewOptionsCtx, rootCtx, parserCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { history, redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark, linkAttr, paragraphAttr } from '@milkdown/kit/preset/commonmark'
import { gfm, insertTableCommand } from '@milkdown/kit/preset/gfm'
import { $nodeSchema, replaceAll } from '@milkdown/kit/utils'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/vue'
import { defineComponent, h, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { escapeRawHtml, migrateLegacyBr } from '../../shared/sanitize'
import { clipboardImageFiles, isAllowedImage, uploadImage } from './image-upload'
import { taskCheckboxes } from './task-checkboxes'
import { configureListSerialization, orderedList } from './ordered-list'
import { readFormatState, runFormat, type FormatAction, type FormatState } from './format'
import { isExternalHref, linkRangeAt, setLink, unlink } from './link'
import { linkTooltip } from './link-tooltip'
import { tableBlock } from './table-block'
import { highlight } from './highlight'
import { handleMarkdownPaste, unwrapMarkdownCodeBlock } from './markdown-paste'

const props = defineProps<{ noteId: string; modelValue: string; editable?: boolean }>()
const emit = defineEmits<{
  /** [新正文, 它改自哪一版正文] */
  'update:modelValue': [string, string]
  /** 提前交卷：[内容所属的 noteId, 新正文, 它改自哪一版正文] */
  flush: [string, string, string]
  /** 光标处可用的格式，驱动工具栏按钮的点亮状态 */
  'format-state': [FormatState]
  /** 气泡里点了「编辑」：宿主弹地址输入框 */
  'edit-link': [string]
  /** 一次性提示（复制成功之类），宿主显示在底栏 */
  notice: [string]
  /** 双击图片：打开灯箱查看 [图片列表, 当前索引] */
  'open-lightbox': [string[], number]
  ready: []
}>()

const DEBOUNCE_MS = 800

let timer: ReturnType<typeof setTimeout> | undefined
let syncingExternally = false
let latest = props.modelValue
let documentNoteId = props.noteId
let pendingId: string | null = null
let pendingMarkdown = props.modelValue
let documentLifetime = 0
let disposed = false
const placeholderCleanups = new Set<() => void>()

function invalidateUploads() {
  documentLifetime++
  for (const cleanup of placeholderCleanups) cleanup()
  placeholderCleanups.clear()
}

/**
 * 编辑器认为数据库此刻存着的正文：初始 modelValue、外部替换进来的值、或自己最近一次交出去的值。
 * 随内容一起上报，数据层拿它和库里的正文比对——不一致就说明用户敲字期间 pull 把另一台设备的
 * 正文落了库，直接覆盖会把那段文字吞掉，而且服务端察觉不到（见 repo.updateBody）。
 */
let base = props.modelValue

/** 交出一份内容：返回它改自哪一版，随后这份内容自己成为新的基线 */
function handOff(markdown: string): string {
  const previous = base
  base = markdown
  return previous
}

/**
 * 空段落的占位字符。Milkdown 默认把空段落序列化成 `<br />`（一个 html 节点）
 * 来保留空行视觉，但它在加载时会被 escapeRawHtml 转成 `&lt;br />` 字面文本，
 * 既破坏空行又留下乱码。改用零宽空格：remark 往返不折叠空段落、escapeRawHtml
 * 不触碰它、视觉上又不可见——空行视觉改由编辑器 CSS 撑高度来保证。
 */
const EMPTY_LINE = '\u200B'
let serializationLastNode: ProseNode | null | undefined

/**
 * 覆盖 commonmark 的段落 schema：toMarkdown 里空段落写零宽空格而非 `<br />`。
 * 其余行为（toDOM/parseDOM/parseMarkdown 与末尾 hardbreak 处理）与原 schema 一致。
 */
const paragraphSchema = $nodeSchema('paragraph', (ctx) => ({
  content: 'inline*',
  group: 'block',
  parseDOM: [{ tag: 'p' }],
  toDOM: (node) => ['p', ctx.get(paragraphAttr.key)(node), 0],
  parseMarkdown: {
    match: (node) => node.type === 'paragraph',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.children) state.next(node.children)
      else state.addText((node.value as string) || '')
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'paragraph',
    runner: (state, node) => {
      const lastNode = serializationLastNode === undefined
        ? ctx.get(editorViewCtx).state?.doc.lastChild
        : serializationLastNode
      state.openNode('paragraph')
      if ((!node.content || node.content.size === 0) && node !== lastNode) {
        state.addNode('text', void 0, EMPTY_LINE)
      } else {
        // 与原 serializeText 一致：段落以 hardbreak 结尾时剔除它，避免多一行
        if (!(node.childCount >= 1 && node.lastChild?.type.name === 'hardbreak')) {
          state.next(node.content)
        } else {
          const contentArr: any[] = []
          node.content.forEach((n, _i, i) => {
            if (i === node.childCount - 1) return
            contentArr.push(n)
          })
          state.next(Fragment.fromArray(contentArr))
        }
      }
      state.closeNode()
    },
  },
}))

function clearTimer() {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
}

/** 取走待存内容并清空待存态；没有待存则返回 null */
function take(): { id: string; markdown: string } | null {
  clearTimer()
  if (pendingId === null) return null
  const pending = { id: pendingId, markdown: pendingMarkdown }
  pendingId = null
  return pending
}

/**
 * 立即交出待存内容。用于切笔记、卸载、页面隐藏三条提前离开的路径。
 * 必须带上 id：flush 发生时 props.noteId 往往已经指向新笔记了。
 */
function flush() {
  // Milkdown's markdownUpdated has its own 200ms debounce. Capture the live
  // upload document before switching/unmounting, not only the last callback.
  const editor = inner.value?.getEditor?.()
  if (placeholderCleanups.size > 0 && editor && editor.status === 'Created') {
    editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      onMarkdownChange(ctx.get(serializerCtx)(doc), ctx)
    })
  }
  const pending = take()
  if (pending) emit('flush', pending.id, pending.markdown, handOff(pending.markdown))
}

/** Serialize a real document, not a Markdown regex: preserve links, code and nested blocks. */
function withoutPlaceholderImages(ctx: Ctx, markdown: string): string {
  const doc = ctx.get(parserCtx)(markdown)
  if (!doc) throw new Error('Unable to parse editor document')
  let removed = false
  function omit(node: ProseNode): ProseNode | null {
    if (node.type.name === 'image' && String(node.attrs.src).startsWith('blob:')) {
      removed = true
      return null
    }
    if (node.isLeaf) return node
    const children: ProseNode[] = []
    node.forEach((child) => {
      const kept = omit(child)
      if (kept) children.push(kept)
    })
    return node.copy(Fragment.fromArray(children))
  }
  const clean = omit(doc)!
  if (!removed) return markdown
  serializationLastNode = clean.lastChild
  try {
    return ctx.get(serializerCtx)(clean)
  } finally {
    serializationLastNode = undefined
  }
}

function onMarkdownChange(markdown: string, ctx?: Ctx) {
  if (syncingExternally || disposed) return
  if (markdown === latest) return

  let persistable = markdown
  if (markdown.includes('blob:')) {
    // The listener supplies its context. The exposed testing/toolbar entry can use
    // the current editor; before editor creation there cannot be an upload node.
    if (ctx) persistable = withoutPlaceholderImages(ctx, markdown)
    else {
      const editor = inner.value?.getEditor?.()
      if (!editor) return
      persistable = editor.action((editorCtx) => withoutPlaceholderImages(editorCtx, markdown))
    }
  }
  latest = markdown
  pendingMarkdown = persistable
  if (persistable === base) {
    pendingId = null
    clearTimer()
    return
  }

  pendingId = documentNoteId
  clearTimer()
  timer = setTimeout(() => {
    const pending = take()
    if (pending) emit('update:modelValue', pending.markdown, handOff(pending.markdown))
  }, DEBOUNCE_MS)
}

  /** 顶栏撤销/重做按钮：按 command 的 key 走 milkdown 命令总线 */
  function runCommand(command: { key: typeof undoCommand.key }) {
    const editor = inner.value?.getEditor?.()
    if (!editor) return
    editor.action((ctx) => {
      ctx.get(commandsCtx).call(command.key)
    })
  }
/**
 * 顶栏「插入图片」按钮走的入口。手机浏览器（iOS Safari、微信内置浏览器等）
 * 基本不会把剪贴板里的图片交给网页 paste 事件，所以粘贴之外必须有文件选择器这条路。
 * 不支持的类型或超限的文件一次性提示，剩下的照常插占位、上传、替换。
 */
function insertImages(files: File[]) {
  const rejected = files.filter((file) => !isAllowedImage(file))
  if (rejected.length > 0) {
    alert(`有 ${rejected.length} 个文件未插入：仅支持 10MB 以内的 JPG、PNG、GIF、WebP 图片`)
  }
  void handleImageFiles(files.filter(isAllowedImage))
}

/**
 * 提前交卷：把 debounce 中还没交出去的内容立刻发出去。
 * 宿主在「切进只读阅读模式」「切笔记」「卸载」这些会打断输入的时机调用。
 */
defineExpose({ onMarkdownChange, flush, insertImages, undo: () => runCommand(undoCommand), redo: () => runCommand(redoCommand), format, insertTable, currentLink, selectedText, setLinkAt, unlinkAt })

/**
 * 工具栏的格式按钮。跑完命令把焦点还给编辑器：按钮上的 mousedown 已经拦掉了失焦，
 * 这一步是为了让键盘用户和「点了没反应」的怀疑都不存在。
 */
function format(action: FormatAction) {
  const editor = inner.value?.getEditor?.()
  if (!editor) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (action !== 'codeBlock' || !unwrapMarkdownCodeBlock(ctx, view)) {
      runFormat(view.state, action, view.dispatch)
    }
    view.focus()
  })
}

/** 插入表格走 Milkdown 的表格预设：行列与对齐都由它决定，比手搓节点稳 */
function insertTable(row = 3, col = 3) {
  const editor = inner.value?.getEditor?.()
  if (!editor) return
  editor.action((ctx) => {
    ctx.get(commandsCtx).call(insertTableCommand.key, { row, col })
    ctx.get(editorViewCtx).focus()
  })
}

/** 光标所在的链接，用来预填编辑弹窗 */
function currentLink(): { href: string; text: string } | null {
  const editor = inner.value?.getEditor?.()
  if (!editor) return null
  return editor.action((ctx) => {
    const range = linkRangeAt(ctx.get(editorViewCtx).state)
    return range ? { href: range.href, text: range.text } : null
  })
}

/** 选中的文字，作为插入链接时的默认显示文字 */
function selectedText(): string {
  const editor = inner.value?.getEditor?.()
  if (!editor) return ''
  return editor.action((ctx) => {
    const { state } = ctx.get(editorViewCtx)
    return state.doc.textBetween(state.selection.from, state.selection.to, ' ')
  })
}

/** 写入或改写链接；地址不合法时不动文档 */
function setLinkAt(href: string, text: string) {
  const editor = inner.value?.getEditor?.()
  if (!editor) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const command = setLink(view.state, href, text)
    if (command) command(view.state, view.dispatch, view)
    view.focus()
  })
}

/** 去掉链接标记，留下文字 */
function unlinkAt() {
  const editor = inner.value?.getEditor?.()
  if (!editor) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const command = unlink(view.state)
    if (command) command(view.state, view.dispatch, view)
    view.focus()
  })
}

/** 上次广播出去的格式，避免每敲一个字就让工具栏重渲染一遍 */
let lastFormatState = ''
function pushFormatState(editorCtx: Ctx) {
  if (props.editable === false) return
  // 编辑器创建期间同样会派发事务，此刻 view.state 还没挂上。直接读 .state 会抛错，
  // 而错误一旦抛在 create() 里，整个编辑器实例就建不出来：provider 的 editor 永远为空，
  // get() 一直返回 undefined，之后切笔记时正文再也不会跟着换。
  const view = editorCtx.get(editorViewCtx)
  if (!view?.state) return
  const next = readFormatState(view.state)
  const key = JSON.stringify(next)
  if (key === lastFormatState) return
  lastFormatState = key
  emit('format-state', next)
}

/**
 * 在光标处插入图片节点（替代旧的全篇 replaceAll 追加：那会把图片甩到整份
 * markdown 末尾、连光标和撤销历史一起丢掉）。用事务改 ProseMirror 文档，
 * 插入后不置 syncingExternally，让 listener 把新内容经 debounce 持久化。
 */
function insertImageAtCursor(editor: Editor, src: string): boolean {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const image = view.state.schema.nodes.image
    if (!image) return false
    const node = image.create({ src, alt: '' })
    view.dispatch(view.state.tr.replaceSelectionWith(node))
    return true
  })
}

/** 上传成功后把占位图的 src 换成正式地址 */
async function updateImageSrc(editor: Editor, fromUrl: string, toUrl: string, isCurrent: () => boolean) {
  // 预载真实图片，下载完再替换占位。否则替换瞬间 <img> 节点被销毁重建，
  // 新图还没下载完就先空白一帧——视觉上就是「闪一下」。
  const img = new Image()
  let finish!: () => void
  const ready = new Promise<void>((resolve) => { finish = resolve })
  const cancel = () => {
    img.onload = null
    img.onerror = null
    finish()
  }
  placeholderCleanups.add(cancel)
  img.onload = finish
  // 加载失败也替换，避免永远停在只在本页有效的 blob:。
  img.onerror = finish
  img.src = toUrl
  if (img.complete) finish()
  await ready
  placeholderCleanups.delete(cancel)
  cancel()
  if (!isCurrent()) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const image = state.schema.nodes.image
    if (!image) return
    const tr = state.tr
    let touched = false
    state.doc.descendants((node, pos) => {
      if (node.type === image && node.attrs.src === fromUrl) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: toUrl })
        touched = true
        return false
      }
      return true
    })
    if (touched) view.dispatch(tr)
  })
}
/**
 * 上传失败时删掉占位节点。只删内联节点本身，外面包它的段落（换行结构）留着，
 * 否则图片后面紧跟的文字会被连带拖进删除范围。
 */
function removeImageAt(editor: Editor, fromUrl: string) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const image = state.schema.nodes.image
    if (!image) return
    const tr = state.tr
    let touched = false
    state.doc.descendants((node, pos) => {
      if (node.type === image && node.attrs.src === fromUrl) {
        tr.delete(pos, pos + node.nodeSize)
        touched = true
        return false
      }
      return true
    })
    if (touched) view.dispatch(tr)
  })
}

async function handleImageFiles(files: File[]) {
  const editor = inner.value?.getEditor?.()
  if (!editor || files.length === 0 || disposed) return
  const noteId = props.noteId
  const lifetime = documentLifetime
  const isCurrent = () => !disposed && props.noteId === noteId
    && lifetime === documentLifetime && inner.value?.getEditor?.() === editor
    && editor.status !== 'Destroyed' && editor.status !== 'OnDestroy'

  // A reusable editor can display another note after either await. Bind every
  // insertion, failure cleanup and preload completion to this document lifetime.
  for (const file of files) {
    if (!isCurrent()) break
    const placeholder = URL.createObjectURL(file)
    let revoked = false
    const cleanup = () => {
      if (revoked) return
      revoked = true
      URL.revokeObjectURL(placeholder)
    }
    placeholderCleanups.add(cleanup)
    try {
      if (!insertImageAtCursor(editor, placeholder)) continue
      const { url } = await uploadImage(file, noteId)
      if (!isCurrent()) break
      await updateImageSrc(editor, placeholder, url, isCurrent)
    } catch (error) {
      if (!isCurrent()) break
      removeImageAt(editor, placeholder)
      alert(`图片上传失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      placeholderCleanups.delete(cleanup)
      cleanup()
    }
  }
}

/** 长按多久算「查看图片」；再短会和滚动/轻点选词打架 */
const LONG_PRESS_MS = 500

/**
 * 取出正文里的全部图片，并算出目标图片排第几。灯箱要能左右翻同一笔记里的图，
 * 所以每次都从文档现取，不缓存——正文随时可能被外部替换。
 */
function imagesAround(view: EditorView, targetPos: number) {
  const imageType = view.state.schema.nodes.image
  const images: string[] = []
  let index = 0
  if (!imageType) return { images, index }
  view.state.doc.descendants((node, pos) => {
    if (node.type !== imageType) return
    const src = String(node.attrs.src ?? '')
    if (!src) return
    if (pos === targetPos) index = images.length
    images.push(src)
  })
  return { images, index }
}

function openLightboxAt(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type !== view.state.schema.nodes.image) return false
  const { images, index } = imagesAround(view, pos)
  if (images.length === 0) return false
  emit('open-lightbox', images, index)
  return true
}

/** 长按计时器。手指抬起、移动或系统打断时都要清掉，否则滚动到一半也会弹灯箱 */
let touchTimer: ReturnType<typeof setTimeout> | undefined

function clearTouchTimer() {
  clearTimeout(touchTimer)
  touchTimer = undefined
}

/**
 * 内部子组件：useEditor 必须在 MilkdownProvider 的后代里执行——
 * provider 在自己的 setup 里 provide(editorInfoCtxKey)，只有它的子组件
 * 才能 inject 到。若在外壳顶层调 useEditor，inject 拿到 undefined，编辑器
 * 实例永远建不起来，桌面端表现为完全无法输入。所以这里单独抽一个组件。
 */
const MilkdownInner = defineComponent({
  name: 'MilkdownInner',
  setup(_, { expose }) {
    const { get } = useEditor((root) =>
      Editor.make()
        .config(configureListSerialization)
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, escapeRawHtml(migrateLegacyBr(props.modelValue)))
          ctx.get(listenerCtx).markdownUpdated((editorCtx, markdown) => onMarkdownChange(markdown, editorCtx))
          // 光标移动与文档变化都要刷新工具栏的点亮状态：命令改的是文档，
          // 点一下按钮后按钮自己也得跟着亮起来
          ctx.get(listenerCtx).updated(pushFormatState)
          ctx.get(listenerCtx).selectionUpdated(pushFormatState)
          ctx.get(listenerCtx).mounted((editorCtx) => {
            if (!props.modelValue.trim() && props.editable !== false) editorCtx.get(editorViewCtx).focus()
            pushFormatState(editorCtx)
            emit('ready')
          })
        })
        // commonmark 在前、gfm 在后：表格删除线任务清单属于 GFM 扩展，
        // 层叠顺序反了会导致 GFM 的 schema 扩展覆盖不到 commonmark 的节点
        .use(commonmark)
        .use(orderedList)
        .use(paragraphSchema)
        .use(gfm)
        .use(tableBlock)
        .use(highlight)
        .use(taskCheckboxes)
        // gap cursor：表格、图片这类块级节点前后本没有文字位置，方向键走到边上时也要能放光标；
        // trailing：文末始终留一个空段落，否则表格在文末时点表格下方无处落光标
        .use(cursor)
        .use(trailing)
        .use(linkTooltip({ edit: (href) => emit('edit-link', href), notify: (message) => emit('notice', message) }))
        .use(listener)
        .use(clipboard)
        // Milestone 8：撤销/重做（自带 Mod-z / Mod-y / Shift-Mod-z 快捷键）
        .use(history)
        .config((ctx) => {
          // 外链补 target 与 rel：不加 noopener 的话，新开的页面能通过 window.opener 反向操作本站
          ctx.update(linkAttr.key, (previous) => (mark) => {
            const attrs = previous(mark)
            const href = String(mark.attrs.href ?? '')
            if (!isExternalHref(href)) return attrs
            return { ...attrs, target: '_blank', rel: 'noopener noreferrer' }
          })
        })
        .config((ctx) => {
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            attributes: { role: 'textbox', 'aria-label': '笔记正文', 'aria-multiline': 'true', spellcheck: 'false' },
            // 回收站详情走 ProseMirror 原生只读，不是 pointer-events:none 那种假只读——
            // 假只读挡得住鼠标，挡不住键盘聚焦和输入法，照样能把内容改了。
            editable: () => props.editable !== false,
            // 点图片时把文本光标放到图片旁边，而不是让 ProseMirror 选中图片本身。
            // 默认的 NodeSelection 会隐藏光标，且此时打字直接把图片替换掉——
            // 手机上传的照片在电脑端往往占满整个编辑区，用户能点的只有图片，
            // 表现就是「点了没光标、打字还把图弄没了」。按点击落在图片左半还是右半决定前后。
            handleClickOn: (view, _pos, node, nodePos, event, direct) => {
              if (!direct || node.type !== view.state.schema.nodes.image) return false
              const target = event.target as HTMLElement | null
              const rect = target?.getBoundingClientRect()
              const after = rect ? event.clientX > rect.left + rect.width / 2 : true
              const pos = after ? nodePos + node.nodeSize : nodePos
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
              view.focus()
              return true
            },
            handleDoubleClickOn: (view, _pos, node, nodePos, event, direct) => {
              if (!direct || node.type !== view.state.schema.nodes.image) return false
              // 双击图片默认会选中整段文字，灯箱一开遮罩就盖住，选中态留到关掉之后很别扭
              event.preventDefault()
              openLightboxAt(view, nodePos)
              return true
            },
            handleDOMEvents: {
              // 手机上没有可靠的 dblclick（双击常被浏览器抢去做缩放），长按才是
              // 移动端「放大看看」的自然手势。手指一动或抬起就取消，避免和滚动抢。
              touchstart: (view, event) => {
                const target = event.target as HTMLElement | null
                if (!view.editable || target?.tagName !== 'IMG') return false
                const pos = view.posAtDOM(target, 0)
                touchTimer = setTimeout(() => {
                  touchTimer = undefined
                  openLightboxAt(view, pos)
                }, LONG_PRESS_MS)
                return false
              },
              touchmove: () => { clearTouchTimer(); return false },
              touchend: () => { clearTouchTimer(); return false },
              touchcancel: () => { clearTouchTimer(); return false },
            },
            handlePaste: (view, event) => {
              // 图片上传与 Markdown 源文各自处理，其余交给默认富文本粘贴。
              const files = clipboardImageFiles(event.clipboardData)
              if (files.length === 0) return handleMarkdownPaste(ctx, view, event)

              void handleImageFiles(files)
              return true
            },
          }))
        })
    )

    expose({
      replaceContent(md: string) {
        const editor = get()
        if (!editor) return
        editor.action(replaceAll(md))
      },
      /**
       * 清空撤销历史，保留当前正文。
       *
       * 必须用在「换了一条笔记」这种换文档的场合：ProseMirror 的 history 是跨文档的，
       * 换笔记时那次 replaceAll 自己也会进历史，于是切过去之后按一次撤销就会把
       * 上一条笔记的正文倒回来——而 listener 认为这是一个正常编辑，照常落库，
       * 当前笔记的内容就被上一条的正文覆盖掉了。
       *
       * 做法是造一个全新 EditorState：doc 与 plugins 都用现成的（所以 view 插件不会
       * 重建、DOM 不动），只有插件状态重新 init，history 于是回到空。
       * updateState 不走事务，milkdown 缓存的 editorStateCtx 得手动跟一下。
       */
      resetHistory() {
        const editor = get()
        if (!editor) return
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const { state } = view
          const fresh = EditorState.create({ schema: state.schema, doc: state.doc, plugins: state.plugins })
          view.updateState(fresh)
          ctx.set(editorStateCtx, fresh)
        })
      },
      getEditor() {
        // Vue can proxy the Editor class. Its lifecycle getters use JS private
        // fields and must run with the original instance as their receiver.
        return toRaw(get())
      },
      undo() {
        const editor = get()
        if (!editor) return
        editor.action((ctx) => ctx.get(commandsCtx).call(undoCommand.key))
      },
      redo() {
        const editor = get()
        if (!editor) return
        editor.action((ctx) => ctx.get(commandsCtx).call(redoCommand.key))
      },
    })

    return () => h(Milkdown)
  },
})

const inner = ref<ComponentPublicInstance<{
  replaceContent: (md: string) => void
  resetHistory: () => void
  getEditor: () => Editor | undefined
  undo: () => void
  redo: () => void
}> | null>(null)

watch(
  () => [props.noteId, props.modelValue] as const,
  ([noteId, markdown], [previousId]) => {
    if (noteId !== previousId) flush()
    // A save echo contains no placeholders. Do not replace the live upload doc.
    else if (markdown === latest || markdown === base || pendingId !== null) return
    invalidateUploads()

    const editor = inner.value
    if (!editor) return

    syncingExternally = true
    try {
      editor.replaceContent(escapeRawHtml(migrateLegacyBr(markdown)))
      // 换了笔记就把撤销历史清干净：history 是跨文档的，留着它按一次撤销
      // 就会把上一条笔记的正文倒回这条笔记并落库（见 resetHistory 的说明）。
      // 同一条笔记的外部替换（恢复到某一版历史、pull 落到本地）不清，
      // 那种情况下「撤销回去」正是用户想要的。
      if (noteId !== previousId) editor.resetHistory()
      latest = markdown
      documentNoteId = noteId
      // 外部替换进来的正文就是库里此刻的正文，之后的输入都改自它
      base = markdown
      if (noteId !== previousId && !markdown.trim() && props.editable !== false) {
        editor.getEditor()?.action(ctx => ctx.get(editorViewCtx).focus())
      }
    } finally {
      syncingExternally = false
    }
  }
)

// pagehide 覆盖手机上「切后台后被系统回收」——那条路径不会触发 onBeforeUnmount
onMounted(() => window.addEventListener('pagehide', flush))
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', flush)
  flush()
  disposed = true
  invalidateUploads()
})
</script>

<template>
  <MilkdownProvider>
    <MilkdownInner ref="inner" />
  </MilkdownProvider>
</template>
