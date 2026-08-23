<script setup lang="ts">
import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { replaceAll } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/vue'
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { escapeRawHtml } from '../../shared/sanitize'
import { isAllowedImage, removePlaceholder, replacePlaceholder, uploadImage } from './image-upload'

const props = defineProps<{ noteId: string; modelValue: string }>()
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

  latest = markdown
  pendingId = props.noteId
  clearTimer()
  timer = setTimeout(() => {
    const pending = take()
    if (pending) emit('update:modelValue', pending.markdown)
  }, DEBOUNCE_MS)
}

defineExpose({ onMarkdownChange })

function pushMarkdown(editor: Editor, markdown: string) {
  latest = markdown
  syncingExternally = true
  editor.action(replaceAll(markdown))
  syncingExternally = false
  emit('update:modelValue', markdown)
}

/**
 * 从剪贴板里取出图片文件。
 * 不能只读 `clipboardData.files`：拖拽与合成 paste 事件经常只把文件挂在
 * `items` 上、`.files` 是空的，只看 `.files` 会漏掉这种来源。
 */
function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const fromFiles = Array.from(data.files ?? [])
  const fromItems = Array.from(data.items ?? [])
    .map((item) => item.getAsFile())
    .filter((f): f is File => f !== null)
  return [...fromFiles, ...fromItems].filter(isAllowedImage)
}

async function handleImageFiles(files: File[]) {
  const editor = inner.value?.getEditor?.()
  if (!editor || files.length === 0) return

  for (const file of files) {
    const placeholder = URL.createObjectURL(file)

    // 先插入占位，界面立即看到图
    pushMarkdown(editor, `${latest}\n\n![](${placeholder})`)

    try {
      const { url } = await uploadImage(file, props.noteId)
      pushMarkdown(editor, replacePlaceholder(latest, placeholder, url))
    } catch (error) {
      // 必须把占位抹掉。blob URL 只在当初那个页面上下文里有效，
      // 留着它就是一条会同步到其他设备、且永远修不好的死链。
      pushMarkdown(editor, removePlaceholder(latest, placeholder))
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
        .use(commonmark)
        .use(listener)
        .use(clipboard)
        .config((ctx) => {
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
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
    })

    return () => h(Milkdown)
  },
})

const inner = ref<ComponentPublicInstance<{ replaceContent: (md: string) => void; getEditor: () => Editor | undefined }> | null>(null)

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
