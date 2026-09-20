<script setup lang="ts">
import ActionMenu from './ActionMenu.vue'
import AppIcon from './AppIcon.vue'

/**
 * 笔记顶栏「⋯」打开的菜单：收拢低频的笔记级操作。
 * 回收站详情不渲染这个菜单；文档信息、历史版本、字数统计和删除只在 ≤720px 出现，
 * 桌面顶栏放得下，它们直接摆在顶栏；手机顶栏没有余量，⋯ 顶替的正是删除按钮的位置。
 */
export type NoteMenuAction = 'info' | 'history' | 'wordcount' | 'copy' | 'download' | 'share' | 'print' | 'trash'

defineProps<{
  open: boolean
  anchor: HTMLElement | null
  canShare: boolean
  showDelete: boolean
  /** 文档信息 / 历史版本 / 字数统计是否进菜单（桌面在顶栏直接可见） */
  showDocItems: boolean
}>()

const emit = defineEmits<{ action: [NoteMenuAction]; close: [] }>()
</script>

<template>
  <ActionMenu :open="open" :anchor="anchor" label="更多操作" menu-class="note-menu" @close="emit('close')">
    <template v-if="showDocItems">
      <button type="button" role="menuitem" class="menu-item" data-action="info" @click="emit('action', 'info')">
        <AppIcon name="info" :size="15" /><span>文档信息</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-action="history" @click="emit('action', 'history')">
        <AppIcon name="clock" :size="15" /><span>历史版本</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-action="wordcount" @click="emit('action', 'wordcount')">
        <AppIcon name="sort" :size="15" /><span>字数统计</span>
      </button>
      <span class="menu-separator" aria-hidden="true"></span>
    </template>
    <button type="button" role="menuitem" class="menu-item" data-action="copy" @click="emit('action', 'copy')">
      <AppIcon name="copy" :size="15" /><span>复制 Markdown</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-action="download" @click="emit('action', 'download')">
      <AppIcon name="download" :size="15" /><span>下载 .md</span>
    </button>
    <button v-if="canShare" type="button" role="menuitem" class="menu-item" data-action="share" @click="emit('action', 'share')">
      <AppIcon name="share" :size="15" /><span>分享到其他应用</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-action="print" @click="emit('action', 'print')">
      <AppIcon name="printer" :size="15" /><span>打印 / 存为 PDF</span>
    </button>
    <template v-if="showDelete">
      <span class="menu-separator" aria-hidden="true"></span>
      <button type="button" role="menuitem" class="menu-item danger" data-action="trash" @click="emit('action', 'trash')">
        <AppIcon name="trash" :size="15" /><span>删除</span>
      </button>
    </template>
  </ActionMenu>
</template>
