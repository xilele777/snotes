<script setup lang="ts">
import { defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { hasToken } from './api/token'
import GroupSidebar from './components/GroupSidebar.vue'
import NoteDetail from './components/NoteDetail.vue'
import NoteList from './components/NoteList.vue'
import TokenGate from './components/TokenGate.vue'
import TrashView from './components/TrashView.vue'
import StatsDialog from './components/StatsDialog.vue'
import { resolveShortcut } from './components/shortcut'
import { backToList, initNavigation, isMobile, pushNav } from './navigation'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'

const notes = useNotesStore()
const ui = useUiStore()
const MetricsView = defineAsyncComponent(() => import('./components/MetricsView.vue'))
const drawerLayout = window.matchMedia('(max-width: 1020px)')
const compact = ref(drawerLayout.matches)
function updateLayout() { compact.value = drawerLayout.matches }
let drawerTrigger: HTMLElement | null = null

watch(() => ui.drawerOpen, async (open) => {
  if (!compact.value || ui.statsOpen) return
  if (open) {
    drawerTrigger = document.activeElement as HTMLElement
    await nextTick()
    if (!ui.statsOpen) document.querySelector<HTMLButtonElement>('.sidebar-close')?.focus()
  } else {
    await nextTick()
    const targets = [drawerTrigger, ...document.querySelectorAll<HTMLElement>('.drawer-btn, .back-btn')]
    const target = targets.find(element => element?.isConnected && element.getClientRects().length && !element.closest('[inert]'))
    if (!ui.statsOpen) target?.focus({ preventScroll: true })
  }
})

watch(() => [notes.currentId, ui.view], () => {
  if (!notes.currentId || ui.view === 'metrics' || ui.view === 'trash') ui.focusMode = false
})

async function focusSearch() {
  ui.focusMode = false
  ui.drawerOpen = false
  if (ui.view === 'metrics') {
    pushNav()
    ui.view = 'all'
    ui.activeGroupId = null
    await notes.load()
  }
  if (isMobile() && ui.mobilePane === 'editor') {
    pushNav()
    notes.currentId = null
    ui.mobilePane = 'list'
  }
  await nextTick()
  document.querySelector<HTMLInputElement>('.note-search input')?.focus()
}

// 移动端 <720px 列表↔编辑器互斥（UI 规格 §2.3）。状态在 ui store 里，
// 导航快照（Bug 2）要靠它保存/恢复。
watch(
  () => notes.currentId,
  (id) => {
    ui.mobilePane = id ? 'editor' : 'list'
  },
  { flush: 'sync' },
)

// 全局快捷键（UI 规格 §6.2）
function onKeydown(e: KeyboardEvent) {
  // 弹窗和菜单打开时把键盘交给它们：Esc 该关的是浮层，不是抽屉或搜索词
  if (!hasToken.value || ui.statsOpen || e.defaultPrevented || e.isComposing || document.querySelector('[aria-modal="true"], [role="menu"]')) return
  if (e.key === 'Escape' && (ui.drawerOpen || ui.focusMode)) {
    e.preventDefault()
    e.stopPropagation()
    if (ui.drawerOpen) ui.drawerOpen = false
    else ui.focusMode = false
    return
  }
  if (e.key === 'Tab' && compact.value && ui.drawerOpen) {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-pane button')).filter(button => !button.disabled && button.getClientRects().length)
    const first = buttons[0]
    const last = buttons.at(-1)
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    return
  }
  const action = resolveShortcut(e, { hasQuery: ui.query.trim().length > 0 })
  if (!action) return
  e.preventDefault()
  e.stopPropagation()

  if (action.type === 'create') {
    notes.create()
  } else if (action.type === 'focusSearch') {
    void focusSearch()
  } else if (action.type === 'clearQuery') {
    ui.query = ''
  }
}

onMounted(() => {
  // 先处理界面快捷键，避免编辑器的 Escape / Mod-K 抢走专注与搜索操作。
  window.addEventListener('keydown', onKeydown, true)
  drawerLayout.addEventListener?.('change', updateLayout)
  // Bug 2：启动时 replaceState 根快照，根界面按返回不退出应用
  initNavigation()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  drawerLayout.removeEventListener?.('change', updateLayout)
})
</script>

<template>
  <TokenGate v-if="!hasToken" />

  <div v-else class="layout" :class="{ 'is-focused': ui.focusMode }" :data-mobile-pane="ui.mobilePane" :data-view="ui.view" :inert="ui.statsOpen">
    <!-- 窄屏将分组导航收进抽屉，搜索仍留在笔记列表上方。 -->
    <aside class="sidebar-pane" :class="{ 'is-open': ui.drawerOpen }" :inert="compact && !ui.drawerOpen">
      <GroupSidebar />
    </aside>
    <div v-if="ui.drawerOpen" class="drawer-mask" @click="ui.drawerOpen = false"></div>

    <section class="list-pane" aria-label="便签目录" :inert="compact && ui.drawerOpen">
      <MetricsView v-if="ui.view === 'metrics'" />
      <TrashView v-else-if="ui.view === 'trash'" />
      <NoteList v-else />
    </section>

    <!--
      回收站详情与编辑详情用同一个组件，只是 readonly 不同。
      key 区分两者：ProseMirror 的 editable 在建实例时读一次，不重挂就切不干净。
      监控页没有笔记详情；统计弹窗不卸载当前工作区。
    -->
    <NoteDetail
      v-if="ui.view !== 'metrics'"
      :key="ui.view === 'trash' ? 'trash' : 'main'"
      :readonly="ui.view === 'trash'"
      :inert="compact && ui.drawerOpen"
      @back="backToList"
    />
  </div>
  <StatsDialog v-if="hasToken" :open="ui.statsOpen" />
</template>
