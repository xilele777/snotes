<script setup lang="ts">
defineProps<{ text: string; action?: string; busy?: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="agent-feedback" role="alert">
    <span>{{ text }}</span>
    <button v-if="action" type="button" :disabled="busy" @click="$emit('retry')">{{ action }}</button>
  </div>
</template>

<style scoped>
.agent-feedback { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; color: var(--text-secondary); font-size: 12px; line-height: 1.8; }
.agent-feedback button { flex: none; min-height: 30px; padding: 3px 0; border: 0; background: transparent; color: var(--text-primary); font-size: inherit; text-decoration: underline; text-underline-offset: 3px; }
.agent-feedback button:hover:not(:disabled) { color: var(--accent); }
.agent-feedback button:disabled { opacity: .5; cursor: default; }
</style>
