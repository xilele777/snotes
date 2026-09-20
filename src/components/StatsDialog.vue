<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { closeOverlay, openStatsNote } from '../navigation'
import AppIcon from './AppIcon.vue'
import { useDialogFocus } from './useDialogFocus'

const props = defineProps<{ open: boolean }>()
const StatsView = defineAsyncComponent(() => import('./StatsView.vue'))
const panel = ref<HTMLElement | null>(null)

useDialogFocus(() => props.open, panel, closeOverlay, () => {
  // 手机抽屉在打开统计时已经收起，关闭后把焦点交回可见入口。
  const candidates = document.querySelectorAll<HTMLElement>('[data-view="stats"].rail-button, .drawer-btn, .back-btn')
  return Array.from(candidates).find(element => element.getClientRects().length > 0 && !element.closest('[inert]')) ?? null
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask stats-mask" @click.self="closeOverlay">
      <div ref="panel" class="dialog stats-dialog" role="dialog" aria-modal="true" aria-label="记录统计">
        <div class="stats-dialog-header">
          <h2 class="dialog-title">统计</h2>
          <button type="button" class="icon-button" aria-label="关闭统计" title="关闭统计" @click="closeOverlay"><AppIcon name="close" :size="20" /></button>
        </div>
        <StatsView @select-note="openStatsNote" />
      </div>
    </div>
  </Teleport>
</template>
