<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDialogFocus } from './useDialogFocus'
const props = defineProps<{ open: boolean; name: string; count: number; busy: boolean; error: string }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const panel = ref<HTMLElement | null>(null)
const input = ref('')
const matches = computed(() => input.value === props.name && !!props.name)
watch(() => props.open, () => { input.value = '' })
function cancel() { if (!props.busy) emit('cancel') }
function confirm() { if (matches.value && !props.busy) emit('confirm') }
useDialogFocus(() => props.open, panel, cancel)
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-mask" @click.self="cancel">
        <div ref="panel" class="dialog delete-notebook-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-notebook-title" aria-describedby="delete-notebook-warning" :aria-busy="busy">
          <h3 id="delete-notebook-title" class="dialog-title">永久删除笔记本</h3>
          <p id="delete-notebook-warning">「{{ name }}」及其中的 {{ count }} 篇笔记将从所有设备永久删除，不进入回收站，无法撤销。</p>
          <p class="delete-shared-warning">这 {{ count }} 篇笔记会连同正文一起删除：即使同时加入了其它笔记本，那里也只会留下「已彻底删除」的占位。删除需要联网。</p>
          <label class="dialog-field">输入完整笔记本名称以确认<strong>{{ name }}</strong><input v-model="input" data-autofocus class="dialog-input" aria-label="确认笔记本名称" autocomplete="off" :disabled="busy" @keydown.enter.prevent="!$event.isComposing && confirm()" /></label>
          <p v-if="error" class="delete-error" role="alert">{{ error }}</p>
          <div class="dialog-footer"><button class="dialog-btn cancel" :disabled="busy" @click="cancel">取消</button><button class="dialog-btn danger" :disabled="!matches || busy" @click="confirm">{{ busy ? '正在删除…' : '永久删除' }}</button></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.delete-notebook-dialog { width: min(440px, calc(100vw - 32px)); }
.delete-notebook-dialog p { font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.delete-shared-warning { color: var(--text-secondary); }
.dialog-field { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; font-size: 13px; }
.dialog-field strong { overflow-wrap: anywhere; font-weight: 600; }
.delete-error { color: var(--danger); }
.dialog-btn.danger { background: var(--danger); color: white; border-color: transparent; }
.dialog-btn:disabled { opacity: .45; cursor: not-allowed; }
</style>
