<script setup lang="ts">
import { ref, watch } from 'vue'
import type { KnowledgeBaseMeta } from '../../shared/knowledge-base'
import { useDialogFocus } from './useDialogFocus'
const props = defineProps<{ open: boolean; initial?: KnowledgeBaseMeta; error?: string; busy?: boolean }>()
const emit = defineEmits<{ save: [KnowledgeBaseMeta]; close: [] }>()
const name = ref('')
const description = ref('')
const icon = ref('📚')
const panel = ref<HTMLElement | null>(null)
watch(() => props.open, open => {
  if (open) { name.value = props.initial?.name ?? ''; description.value = props.initial?.description ?? ''; icon.value = props.initial?.icon ?? '📚' }
}, { immediate: true })
useDialogFocus(() => props.open, panel, () => emit('close'))
function save() {
  if (!name.value.trim() || props.busy) return
  emit('save', { name: name.value.trim(), description: description.value, icon: icon.value, ord: props.initial?.ord ?? 0, invalid: props.initial?.invalid ?? 0 })
}
</script>
<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-mask" @click.self="emit('close')">
        <form ref="panel" class="dialog kb-form" role="dialog" aria-modal="true" :aria-label="initial ? '编辑笔记本' : '新建笔记本'" @submit.prevent="save">
          <h3 class="dialog-title">{{ initial ? '编辑笔记本' : '新建笔记本' }}</h3>
          <label>名称<input v-model="name" class="dialog-input" aria-label="笔记本名称" placeholder="例如：产品设计、读书笔记" maxlength="100" required /></label>
          <label>图标<input v-model="icon" class="dialog-input" aria-label="笔记本图标" maxlength="32" /></label>
          <label>简介<textarea v-model="description" class="dialog-input" aria-label="笔记本简介" placeholder="这个笔记本记录什么？" maxlength="2000" rows="3"></textarea></label>
          <p v-if="error" role="alert">{{ error }}</p>
          <div class="dialog-footer"><button type="button" class="dialog-btn cancel" :disabled="busy" @click="emit('close')">取消</button><button class="dialog-btn ok" :disabled="!name.trim() || busy" :aria-busy="busy">{{ busy ? '保存中…' : '保存' }}</button></div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>
<style scoped>
.kb-form { width: 440px; }
.kb-form label { display: block; margin: 18px 0; color: var(--text-secondary); font-size: 13px; }
.kb-form .dialog-input { display: block; margin-top: 7px; width: 100%; }
</style>
