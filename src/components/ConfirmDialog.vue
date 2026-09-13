<script setup lang="ts">
import { ref } from 'vue'
import { useDialogFocus } from './useDialogFocus'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 标题，如「删除这条笔记？」 */
    title: string
    /** 说明，如「笔记会移入回收站，可随时恢复。」 */
    message?: string
    /** 确定钮文案，如「删除」/「彻底删除」/「清空回收站」 */
    confirmText?: string
  }>(),
  { message: '', confirmText: '确定' }
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()
const panel = ref<HTMLElement | null>(null)
useDialogFocus(() => props.open, panel, () => emit('cancel'))
</script>

<template>
  <div v-if="open" class="dialog-mask" @click.self="emit('cancel')">
    <div ref="panel" class="dialog confirm-dialog" role="alertdialog" aria-modal="true" :aria-label="title">
      <h3 class="dialog-title">{{ title }}</h3>
      <p v-if="message" class="confirm-message">{{ message }}</p>
      <div class="dialog-footer">
        <button class="dialog-btn cancel" data-op="cancel" data-autofocus @click="emit('cancel')">取消</button>
        <button class="dialog-btn ok" data-op="confirm" @click="emit('confirm')">
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
