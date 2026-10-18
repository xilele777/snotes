<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUiStore } from '../stores/ui'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ first: [] }>()
const ui = useUiStore()
const input = ref<HTMLInputElement | null>(null)
const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ F' : 'Ctrl F'
const placeholder = computed(() => ui.view === 'group' ? '搜索当前分组' : ui.view === 'star' ? '搜索星标笔记' : ui.view === 'hidden' ? '搜索隐藏笔记' : ui.view === 'trash' ? '搜索回收站' : '搜索笔记')

function clear() {
  ui.query = ''
  input.value?.focus()
}

function selectFirst(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  emit('first')
}
</script>

<template>
  <div class="note-search" role="search">
    <AppIcon name="search" :size="16" />
    <input ref="input" v-model="ui.query" type="search" :placeholder="placeholder" aria-label="搜索笔记" :title="placeholder" autocomplete="off" @keydown.down="selectFirst" @keydown.enter="selectFirst" />
    <button v-if="ui.query" class="search-clear" title="清除搜索" aria-label="清除搜索" @click="clear"><AppIcon name="close" :size="14" /></button>
    <kbd v-else aria-hidden="true">{{ shortcut }}</kbd>
  </div>
</template>
