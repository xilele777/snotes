<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    hint?: string
    /** 动作按钮文案；不传则不渲染按钮 */
    action?: string
  }>(),
  { hint: '', action: '' }
)

defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-state">
    <!-- 线稿插画：内联 SVG + currentColor，不引外部资源（UI 规格 §1.3） -->
    <svg class="empty-art" width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="24" y="14" width="48" height="64" rx="6" />
      <path d="M36 32h24M36 44h24M36 56h14" stroke-linecap="round" />
    </svg>

    <p class="empty-title">{{ title }}</p>
    <p v-if="hint" class="empty-hint">{{ hint }}</p>
    <button v-if="action" class="empty-action" @click="$emit('action')">{{ action }}</button>
  </div>
</template>
