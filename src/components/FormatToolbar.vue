<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'
import type { FormatAction, FormatState } from '../editor/format'

/**
 * 工具栏动作比 format.ts 里的纯格式动作多两个：
 * - `table` 走 Milkdown 的表格预设命令（依赖表格 schema 与编辑器上下文）
 * - `link` 需要先收地址，由 NoteDetail 弹一个输入框
 */
export type ToolbarAction = FormatAction | 'table' | 'link'

const props = defineProps<{ state: FormatState }>()
const emit = defineEmits<{ action: [ToolbarAction] }>()

interface ToolItem {
  action: ToolbarAction
  icon: IconName
  label: string
}

const TOOLS: ToolItem[] = [
  { action: 'bold', icon: 'bold', label: '加粗' },
  { action: 'italic', icon: 'italic', label: '斜体' },
  { action: 'strike', icon: 'strike', label: '删除线' },
  { action: 'inlineCode', icon: 'code', label: '行内代码' },
  { action: 'bulletList', icon: 'bulletList', label: '无序列表' },
  { action: 'orderedList', icon: 'orderedList', label: '有序列表' },
  { action: 'taskList', icon: 'taskList', label: '待办清单' },
  { action: 'quote', icon: 'quote', label: '引用' },
  { action: 'codeBlock', icon: 'codeBlock', label: '代码块' },
]

const HEADINGS = [
  { action: 'heading1', text: 'H1', label: '一级标题' },
  { action: 'heading2', text: 'H2', label: '二级标题' },
  { action: 'heading3', text: 'H3', label: '三级标题' },
] as const

/** 光标处的格式决定按钮是否点亮，让「现在是什么格式」一眼可见 */
function pressed(action: ToolbarAction): boolean {
  switch (action) {
    case 'bold': return props.state.bold
    case 'italic': return props.state.italic
    case 'strike': return props.state.strike
    case 'inlineCode': return props.state.inlineCode
    case 'link': return props.state.link
    case 'bulletList': return props.state.list === 'bullet'
    case 'orderedList': return props.state.list === 'ordered'
    case 'taskList': return props.state.list === 'task'
    case 'quote': return props.state.quote
    case 'codeBlock': return props.state.codeBlock
    case 'heading1': return props.state.heading === 1
    case 'heading2': return props.state.heading === 2
    case 'heading3': return props.state.heading === 3
    default: return false
  }
}
</script>

<template>
  <!--
    单独一行的格式工具栏：顶栏在 320px 已经排满，塞不下十几个按钮。
    窄屏横向滚动，按钮始终在同一行，不会把页面撑宽。
    mousedown.prevent 是关键——不拦住它，按一下按钮编辑器就失焦，
    选区没了、手机键盘也收了，格式自然应用不到选中的文字上。
  -->
  <div class="format-bar" role="toolbar" aria-label="格式工具栏" @mousedown.prevent>
    <button
      v-for="h in HEADINGS"
      :key="h.action"
      class="format-btn format-heading"
      :class="{ selected: pressed(h.action) }"
      :data-format="h.action"
      :aria-pressed="pressed(h.action)"
      :aria-label="h.label"
      :title="h.label"
      @click="emit('action', h.action)"
    >
      {{ h.text }}
    </button>

    <span class="format-separator" aria-hidden="true"></span>

    <button
      v-for="tool in TOOLS"
      :key="tool.action"
      class="format-btn"
      :class="{ selected: pressed(tool.action) }"
      :data-format="tool.action"
      :aria-pressed="pressed(tool.action)"
      :aria-label="tool.label"
      :title="tool.label"
      @click="emit('action', tool.action)"
    >
      <AppIcon :name="tool.icon" :size="16" />
    </button>

    <span class="format-separator" aria-hidden="true"></span>

    <button
      class="format-btn"
      :class="{ selected: pressed('link') }"
      data-format="link"
      :aria-pressed="pressed('link')"
      aria-label="链接"
      title="链接"
      @click="emit('action', 'link')"
    >
      <AppIcon name="link" :size="16" />
    </button>

    <button class="format-btn" data-format="table" aria-label="插入表格" title="插入表格" @click="emit('action', 'table')">
      <AppIcon name="table" :size="16" />
    </button>
  </div>
</template>
