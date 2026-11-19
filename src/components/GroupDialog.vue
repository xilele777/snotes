<script setup lang="ts">
import { ref, watch } from 'vue'
import NativeDialog from './NativeDialog.vue'

const props = defineProps<{ open: boolean; title: string; initial?: string }>()
const emit = defineEmits<{ submit: [string]; close: [] }>()

const value = ref('')

watch(
  () => props.open,
  (open) => { if (open) value.value = props.initial ?? '' },
  { immediate: true },
)

function submit(event?: Event) {
  if (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229)) return
  const name = value.value.trim()
  if (!name) return
  emit('submit', name)
}
</script>

<template>
  <Teleport to="body">
    <NativeDialog :open="open" :aria-label="title" @close="emit('close')">
      <div class="dialog">
        <p class="dialog-title">{{ title }}</p>
        <p class="empty-hint">分组用于按主题归类笔记；需要章节目录时，可以使用笔记本。</p>

        <input
          v-model="value"
          autofocus
          class="dialog-input"
          type="text"
          aria-label="分组名称"
          placeholder="分组名称"
          @keydown.enter="submit"
        />

        <div class="dialog-footer">
          <button class="dialog-btn cancel" @click="$emit('close')">取消</button>
          <button class="dialog-btn ok" :disabled="!value.trim()" @click="submit">确定</button>
        </div>
      </div>
    </NativeDialog>
  </Teleport>
</template>
