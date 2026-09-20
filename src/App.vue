<script setup lang="ts">
import { defineAsyncComponent, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { hasToken } from './api/token'
import GroupSidebar from './components/GroupSidebar.vue'
import NoteDetail from './components/NoteDetail.vue'
import NoteList from './components/NoteList.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import StatsDialog from './components/StatsDialog.vue'
import Toast from './components/Toast.vue'
import TokenGate from './components/TokenGate.vue'
import TrashView from './components/TrashView.vue'
import { resolveShortcut, type ShortcutAction } from './components/shortcut'
import { useMediaQuery } from './components/useMediaQuery'
import { backToList, initNavigation, isMobile, openOverlay, pushNav, switchListView } from './navigation'
import { useGroupsStore } from './stores/groups'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import { syncNow } from './sync/engine'

const notes = useNotesStore()
const groups = useGroupsStore()
const ui = useUiStore()
const MetricsView = defineAsyncComponent(() => import('./components/MetricsView.vue'))
/** ≤1020px 侧栏是抽屉 */
const compact = useMediaQuery('(max-width: 1020px)')
let drawerTrigger: HTMLElement | null = null

watch(() => ui.drawerOpen, async (open) => {
  if (!compact.value || ui.overlay) return
  if (open) {
    drawerTrigger = document.activeElement as HTMLElement
    await nextTick()
    if (!ui.overlay) document.querySelector<HTMLButtonElement>('.sidebar-close')?.focus()
  } else {
    await nextTick()
    const targets = [drawerTrigger, ...document.querySelectorAll<HTMLElement>('.drawer-btn, .back-btn')]
    const target = targets.find(element => element?.isConnected && element.getClientRects().length && !element.closest('[inert]'))
    if (!ui.overlay) target?.focus({ preventScroll: true })
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
  if (!hasToken.value || ui.overlay || e.defaultPrevented || e.isComposing || document.querySelector('[aria-modal="true"], [role="menu"]')) return
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

  void runShortcut(action)
}

/** 相对当前选中项在可见列表里前后移动；没有选中项时从第一条开始 */
function stepNote(delta: number) {
  const list = notes.visible
  if (list.length === 0) return
  const index = list.findIndex((n) => n.id === notes.currentId)
  const next = index === -1 ? 0 : Math.min(list.length - 1, Math.max(0, index + delta))
  if (list[next].id === notes.currentId) return
  if (isMobile() && ui.mobilePane === 'list') pushNav()
  notes.currentId = list[next].id
}

async function runShortcut(action: ShortcutAction) {
  const current = notes.current
  const editable = current && ui.view !== 'trash' && ui.view !== 'metrics'
  switch (action.type) {
    case 'create': void notes.create(); return
    case 'focusSearch': await focusSearch(); return
    case 'clearQuery': ui.query = ''; return
    case 'toggleStar': if (editable) await notes.setProps(current.id, { star: current.star === 1 ? 0 : 1 }); return
    case 'togglePin': if (editable) await notes.setProps(current.id, { top: current.top === 1 ? 0 : 1 }); return
    // 删除仍要走确认弹窗：计数加一，NoteDetail 监听到就弹出与鼠标路径相同的确认框
    case 'trash': if (editable) ui.trashRequest += 1; return
    case 'nextNote': stepNote(1); return
    case 'prevNote': stepNote(-1); return
    case 'toggleFocus': if (editable) ui.focusMode = !ui.focusMode; return
    case 'syncNow': await syncNow(); return
    case 'showAll': await switchListView('all'); return
    case 'showGroup': {
      const group = groups.groups[action.index]
      if (group) await switchListView('group', group.group_id)
      return
    }
    case 'openSettings': openOverlay('settings'); return
  }
}

onMounted(() => {
  // 先处理界面快捷键，避免编辑器的 Escape / Mod-K 抢走专注与搜索操作。
  window.addEventListener('keydown', onKeydown, true)
  // Bug 2：启动时 replaceState 根快照，根界面按返回不退出应用
  initNavigation()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <TokenGate v-if="!hasToken" />

  <div v-else class="layout" :class="{ 'is-focused': ui.focusMode }" :data-mobile-pane="ui.mobilePane" :data-view="ui.view" :inert="ui.overlay !== null">
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
      监控页没有笔记详情；统计与设置弹窗都不卸载当前工作区。
    -->
    <NoteDetail
      v-if="ui.view !== 'metrics'"
      :key="ui.view === 'trash' ? 'trash' : 'main'"
      :readonly="ui.view === 'trash'"
      :inert="compact && ui.drawerOpen"
      @back="backToList"
    />
  </div>
  <StatsDialog v-if="hasToken" :open="ui.overlay === 'stats'" />
  <SettingsDialog v-if="hasToken" :open="ui.overlay === 'settings'" />
  <Toast />
</template>
