<script setup lang="ts">
import { commandsCtx, Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history, redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { replaceAll } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/vue'
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { escapeRawHtml } from '../../shared/sanitize'
import { clipboardImageFiles, uploadImage } from './image-upload'

const props = defineProps<{ noteId: string; modelValue: string; editable?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [string]
  /** 提前交卷，第一个参数是内容所属的 noteId */
  flush: [string, string]
}>()

const DEBOUNCE_MS = 800

let timer: ReturnType<typeof setTimeout> | undefined
let syncingExternally = false
let latest = props.modelValue
let pendingId: string | null = null

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
  const pending = { id: pendingId, markdown: latest }
  pendingId = null
  return pending
}

/**
 * 立即交出待存内容。用于切笔记、卸载、页面隐藏三条提前离开的路径。
 * 必须带上 id：flush 发生时 props.noteId 往往已经指向新笔记了。
 */
function flush() {
  const pending = take()
  if (pending) emit('flush', pending.id, pending.markdown)
}

function onMarkdownChange(markdown: string) {
  if (syncingExternally) return
  if (markdown === latest) return

  // 占位图还在上传中（src 是 blob:），此时持久化会把只在当前页有效的 blob:
  // 写进库，并可能被同步推到服务端，其它设备拉下来就是死链且再也不会收敛。
  // 等真实 URL 替换进来、触发新一轮 markdownUpdated 后再落库。
  // 仍更新 latest：替换后那条 markdown 同值时直接走上面的早退，不会漏存。
  latest = markdown
  if (/]\(blob:[^)]+\)/.test(markdown)) {
    pendingId = null
    clearTimer()
    return
  }

  pendingId = props.noteId
  clearTimer()
  timer = setTimeout(() => {
    const pending = take()
    if (pending) emit('update:modelValue', pending.markdown)
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
defineExpose({ onMarkdownChange, undo: () => runCommand(undoCommand), redo: () => runCommand(redoCommand) })

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
function updateImageSrc(editor: Editor, fromUrl: string, toUrl: string) {
  // 预载真实图片，下载完再替换占位。否则替换瞬间 <img> 节点被销毁重建，
  // 新图还没下载完就先空白一帧——视觉上就是「闪一下」。
  const img = new Image()
  img.src = toUrl
  const ready = img.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        img.onload = () => resolve()
        // 加载失败也要继续：换成破图占位比永远停在 blob:（只在本页有效）好
        img.onerror = () => resolve()
      })

  ready.then(() => {
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
  if (!editor || files.length === 0) return

  // 逐张来：光标处插占位 → 上传 → 成功换 src / 失败删节点。
  // 不做整篇 replaceAll，光标和撤销历史都保留着。
  for (const file of files) {
    const placeholder = URL.createObjectURL(file)

    if (!insertImageAtCursor(editor, placeholder)) {
      URL.revokeObjectURL(placeholder)
      continue
    }

    try {
      const { url } = await uploadImage(file, props.noteId)
      updateImageSrc(editor, placeholder, url)
    } catch (error) {
      // 必须把占位抹掉。blob URL 只在当初那个页面上下文里有效，
      // 留着它就是一条会同步到其他设备、且永远修不好的死链。
      removeImageAt(editor, placeholder)
      alert(`图片上传失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      URL.revokeObjectURL(placeholder)
    }
  }
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
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, escapeRawHtml(props.modelValue))
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => onMarkdownChange(markdown))
        })
        // commonmark 在前、gfm 在后：表格删除线任务清单属于 GFM 扩展，
        // 层叠顺序反了会导致 GFM 的 schema 扩展覆盖不到 commonmark 的节点
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(clipboard)
        // Milestone 8：撤销/重做（自带 Mod-z / Mod-y / Shift-Mod-z 快捷键）
        .use(history)
        .config((ctx) => {
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            // 回收站详情走 ProseMirror 原生只读，不是 pointer-events:none 那种假只读——
            // 假只读挡得住鼠标，挡不住键盘聚焦和输入法，照样能把内容改了。
            editable: () => props.editable !== false,
            handlePaste: (_view, event) => {
              // 只拦图片。全量拦截会把复制来的富文本、文件附件一并吞掉，
              // 而 return true 意味着 ProseMirror 不再执行默认粘贴——文字就丢了。
              const files = clipboardImageFiles(event.clipboardData)
              if (files.length === 0) return false

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
      getEditor() {
        return get()
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
  getEditor: () => Editor | undefined
  undo: () => void
  redo: () => void
}> | null>(null)

watch(
  () => props.noteId,
  () => {
    // 先把上一条的待存内容交出去，再换内容。顺序反了就是丢字。
    flush()

    const editor = inner.value
    if (!editor) return

    syncingExternally = true
    editor.replaceContent(escapeRawHtml(props.modelValue))
    syncingExternally = false
    latest = props.modelValue
  }
)

// pagehide 覆盖手机上「切后台后被系统回收」——那条路径不会触发 onBeforeUnmount
onMounted(() => window.addEventListener('pagehide', flush))
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', flush)
  flush()
})
</script>

<template>
  <MilkdownProvider>
    <MilkdownInner ref="inner" />
  </MilkdownProvider>
</template>
