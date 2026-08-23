<script setup lang="ts">
import { Editor, defaultValueCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { replaceAll } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/vue'
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { escapeRawHtml } from '../../shared/sanitize'

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
    )

    expose({
      replaceContent(md: string) {
        const editor = get()
        if (!editor) return
        editor.action(replaceAll(md))
      },
    })

    return () => h(Milkdown)
  },
})

const inner = ref<ComponentPublicInstance<{ replaceContent: (md: string) => void }> | null>(null)

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
