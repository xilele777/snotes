<script setup lang="ts">
import NativeDialog from './NativeDialog.vue'
import type { NoteWordCount } from '../../shared/derive'

const props = defineProps<{ open: boolean; count: NoteWordCount }>()
const emit = defineEmits<{ close: [] }>()

</script>

<template>
  <Teleport to="body">
    <NativeDialog :open="open" aria-label="字数统计" @close="emit('close')">
      <div class="dialog wordcount-dialog">
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
    </NativeDialog>
  </Teleport>
</template>
