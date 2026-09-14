<script setup lang="ts">
import { ref } from 'vue'
import { useDialogFocus } from './useDialogFocus'
import type { NoteWordCount } from '../../shared/derive'

const props = defineProps<{ open: boolean; count: NoteWordCount }>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
useDialogFocus(() => props.open, panel, () => emit('close'))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="emit('close')">
      <div ref="panel" class="dialog wordcount-dialog" role="dialog" aria-modal="true" aria-label="字数统计">
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
        <div class="dialog-footer">
          <button class="dialog-btn ok" @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
