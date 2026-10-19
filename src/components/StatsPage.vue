<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue'
import { closeWorkspacePage, openDrawer } from '../navigation'
import AppIcon from './AppIcon.vue'

defineProps<{ open: boolean }>()
const StatsView = defineAsyncComponent(() => import('./StatsView.vue'))
const heading = ref<HTMLElement | null>(null)
onMounted(() => heading.value?.focus({ preventScroll: true }))
</script>

<template>
  <section v-if="open" class="workspace-page stats-page" role="region" aria-label="统计">
    <header class="workspace-page-header">
      <button class="drawer-btn" aria-label="打开侧栏" @click="openDrawer"><AppIcon name="menu" /></button>
      <h1 ref="heading" tabindex="-1">统计</h1>
      <button class="page-back" aria-label="返回工作区" @click="closeWorkspacePage"><AppIcon name="back" :size="17" /><span>返回工作区</span></button>
    </header>
    <StatsView />
  </section>
</template>
