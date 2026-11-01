<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useUiStore } from '../stores/ui'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ first: [] }>()
const ui = useUiStore()
const input = ref<HTMLInputElement | null>(null)
const scopeId = useId()
const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
const placeholder = computed(() => ui.view === 'group' ? '搜索当前分组' : ui.view === 'home' ? '搜索随手记' : ui.view === 'star' ? '搜索星标笔记' : ui.view === 'hidden' ? '搜索隐藏笔记' : ui.view === 'trash' ? '搜索回收站' : '搜索全部笔记（含笔记本）')

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
  <div class="note-search-block" role="search">
  <div class="note-search">
    <AppIcon name="search" :size="16" />
    <input ref="input" v-model="ui.query" type="search" placeholder="搜索笔记" aria-label="搜索笔记" :aria-describedby="scopeId" :title="`${placeholder} · ${shortcut}`" autocomplete="off" @keydown.down="selectFirst" @keydown.enter="selectFirst" />
    <button v-if="ui.query" class="search-clear" title="清除搜索" aria-label="清除搜索" @click="clear"><AppIcon name="close" :size="14" /></button>
    <kbd v-else aria-hidden="true">{{ shortcut }}</kbd>
  </div>
  <p :id="scopeId" class="search-scope">范围：{{ placeholder.replace(/^搜索/, '') }}</p>
  </div>
</template>
