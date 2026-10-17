<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import AppIcon from '../AppIcon.vue'

defineProps<{ id: string; label: string; text: string }>()
const root = ref<HTMLElement | null>(null)
const open = ref(false)

function onMouseLeave() {
  if (!root.value?.contains(document.activeElement)) open.value = false
}

function onOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onOutside)
  document.addEventListener('keydown', onEscape)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onOutside)
  document.removeEventListener('keydown', onEscape)
})
</script>

<template>
  <span ref="root" class="settings-help" @mouseenter="open = true" @mouseleave="onMouseLeave" @focusin="open = true" @focusout="open = false" @keydown.esc.stop="open = false">
    <button type="button" class="settings-hint-button" :aria-label="`${label}说明`" :aria-describedby="open ? id : undefined" @click="open = true">
      <AppIcon name="info" :size="14" />
    </button>
    <span v-if="open" :id="id" class="settings-hint-tooltip" role="tooltip">{{ text }}</span>
  </span>
</template>

<style scoped>
.settings-help { display: inline-flex; flex: none; font-weight: 400; }
.settings-hint-button { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--text-tertiary); }
.settings-hint-button:hover, .settings-hint-button:focus-visible { color: var(--accent); background: var(--bg-hover); }
.settings-hint-tooltip { position: absolute; z-index: 2; left: 0; top: calc(100% + 6px); width: 280px; max-width: 100%; padding: 10px 12px; border: 1px solid var(--border-default); border-radius: 7px; background: var(--bg-surface); color: var(--text-secondary); box-shadow: 0 6px 20px rgb(0 0 0 / 10%); font-size: 12px; line-height: 1.7; white-space: normal; }
.settings-hint-tooltip::before { content: ''; position: absolute; left: 0; right: 0; top: -7px; height: 7px; }
</style>
