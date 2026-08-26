<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import type { NoteWordCount } from '../../shared/derive'

const props = defineProps<{ open: boolean; count: NoteWordCount }>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  e.preventDefault()
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown, true)
    else window.removeEventListener('keydown', onKeydown, true)
  }
)
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="emit('close')">
      <div class="dialog wordcount-dialog" role="dialog" aria-modal="true" aria-label="字数统计">
        <h3 class="dialog-title">字数统计</h3>
        <ul class="wordcount-list">
          <li class="wordcount-item primary">
            <span class="wordcount-num">{{ count.words }}</span>
            <span class="wordcount-label">字</span>
          </li>
          <li class="wordcount-item">
            <span class="wordcount-num">{{ count.lines }}</span>
            <span class="wordcount-label">非空行</span>
          </li>
          <li class="wordcount-item">
            <span class="wordcount-num">{{ count.chars }}</span>
            <span class="wordcount-label">可见字符</span>
          </li>
        </ul>
        <p class="wordcount-hint">中文按字、英文按词计数，不含 Markdown 语法符号。</p>
        <div class="dialog-footer">
          <button class="dialog-btn ok" @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
