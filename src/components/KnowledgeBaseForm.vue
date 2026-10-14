<script setup lang="ts">
import { ref, watch } from 'vue'
import type { KnowledgeBaseMeta } from '../../shared/knowledge-base'
import { useDialogFocus } from './useDialogFocus'
const props = defineProps<{ open: boolean; initial?: KnowledgeBaseMeta; error?: string }>()
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
  if (!name.value.trim()) return
  emit('save', { name: name.value.trim(), description: description.value, icon: icon.value, ord: props.initial?.ord ?? 0, invalid: props.initial?.invalid ?? 0 })
}
</script>
<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="emit('close')">
      <form ref="panel" class="dialog kb-form" role="dialog" aria-modal="true" :aria-label="initial ? '编辑知识库' : '新建知识库'" @submit.prevent="save">
        <h3 class="dialog-title">{{ initial ? '编辑知识库' : '新建知识库' }}</h3>
        <label>名称<input v-model="name" class="dialog-input" aria-label="知识库名称" placeholder="例如：产品设计、读书笔记" maxlength="100" required /></label>
        <label>图标<input v-model="icon" class="dialog-input" aria-label="知识库图标" maxlength="32" /></label>
        <label>简介<textarea v-model="description" class="dialog-input" aria-label="知识库简介" placeholder="这套知识库记录什么？" maxlength="2000" rows="3"></textarea></label>
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="dialog-footer"><button type="button" class="dialog-btn cancel" @click="emit('close')">取消</button><button class="dialog-btn ok" :disabled="!name.trim()">保存</button></div>
      </form>
    </div>
  </Teleport>
</template>
<style scoped>
.kb-form label { display: block; margin: 14px 0; color: var(--text-secondary); }
.kb-form .dialog-input { display: block; margin-top: 5px; width: 100%; }
.kb-form textarea { resize: vertical; min-height: 80px; }
</style>
