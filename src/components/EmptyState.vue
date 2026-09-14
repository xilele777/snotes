<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    title: string
    hint?: string
    icon?: 'note' | 'trash' | 'search'
    /** 动作按钮文案；不传则不渲染按钮 */
    action?: string
  }>(),
  { hint: '', action: '', icon: 'note' }
)

defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-state">
    <AppIcon :name="icon" :size="40" class="empty-art" />

    <p class="empty-title">{{ title }}</p>
    <p v-if="hint" class="empty-hint">{{ hint }}</p>
    <button v-if="action" class="empty-action" @click="$emit('action')">{{ action }}</button>
  </div>
</template>
