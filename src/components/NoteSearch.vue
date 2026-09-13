<script setup lang="ts">
import { ref } from 'vue'
import { useUiStore } from '../stores/ui'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ first: [] }>()
const ui = useUiStore()
const input = ref<HTMLInputElement | null>(null)
const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'

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
    <input ref="input" v-model="ui.query" type="search" placeholder="搜索笔记" aria-label="搜索笔记" autocomplete="off" @keydown.down="selectFirst" @keydown.enter="selectFirst" />
    <button v-if="ui.query" class="search-clear" title="清除搜索" aria-label="清除搜索" @click="clear"><AppIcon name="close" :size="14" /></button>
    <kbd v-else aria-hidden="true">{{ shortcut }}</kbd>
  </div>
</template>
