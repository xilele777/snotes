<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { hasToken } from './api/token'
import GroupSidebar from './components/GroupSidebar.vue'
import NoteDetail from './components/NoteDetail.vue'
import NoteList from './components/NoteList.vue'
import SettingsPage from './components/SettingsPage.vue'
import StatsPage from './components/StatsPage.vue'
import Toast from './components/Toast.vue'
import TokenGate from './components/TokenGate.vue'
import TrashView from './components/TrashView.vue'
import WorkspaceDivider from './components/WorkspaceDivider.vue'
import { resolveShortcut, type ShortcutAction } from './components/shortcut'
import { useMediaQuery } from './components/useMediaQuery'
import { backToList, initNavigation, isMobile, openWorkspacePage, pushNav, showNotes } from './navigation'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import { retrySyncNow } from './sync/engine'
import { workspacePreferences as preferences, updateWorkspacePreferences, WORKSPACE_WIDTHS } from './workspace-preferences'

const notes = useNotesStore()
const ui = useUiStore()
const MetricsView = defineAsyncComponent(() => import('./components/MetricsView.vue'))
const KnowledgeBaseWorkspace = defineAsyncComponent(() => import('./components/KnowledgeBaseWorkspace.vue'))
const KnowledgeBaseHome = defineAsyncComponent(() => import('./components/KnowledgeBaseHome.vue'))
/** ≤1020px 侧栏是抽屉 */
const compact = useMediaQuery('(max-width: 1020px)')
const viewportWidth = ref(window.innerWidth)
function updateViewport() { viewportWidth.value = window.innerWidth }
const sidebarWidth = computed(() => preferences.value.sidebarCollapsed ? 60 : preferences.value.sidebarWidth)
// Leave at least 360px for the editor when the window or either column changes size.
const listMax = computed(() => Math.min(WORKSPACE_WIDTHS.list.max, Math.max(WORKSPACE_WIDTHS.list.min, viewportWidth.value - (compact.value ? 0 : sidebarWidth.value) - 360)))
const listWidth = computed(() => Math.min(preferences.value.listWidth, listMax.value))
const hasEditor = computed(() => !!notes.current && !ui.workspacePage && ui.view !== 'metrics' && !(ui.view === 'knowledge-bases' && !ui.activeKnowledgeBaseId))
const listCollapsed = computed(() => preferences.value.listCollapsed && hasEditor.value)
let drawerTrigger: HTMLElement | null = null

// Browser Back/Forward can also change the destination without using a sidebar action.
watch(() => [ui.view, ui.activeGroupId, ui.activeKnowledgeBaseId], () => {
  if (preferences.value.listCollapsed) updateWorkspacePreferences({ listCollapsed: false })
})

watch(() => ui.drawerOpen, async (open) => {
  if (!compact.value) return
  if (open) {
    drawerTrigger = document.activeElement as HTMLElement
    await nextTick()
    document.querySelector<HTMLButtonElement>('.sidebar-close')?.focus()
  } else {
    await nextTick()
    const targets = [drawerTrigger, document.querySelector<HTMLElement>('.workspace-page h1'), ...document.querySelectorAll<HTMLElement>('.drawer-btn, .back-btn')]
    const target = targets.find(element => element?.isConnected && element.getClientRects().length && !element.closest('[inert]'))
    target?.focus({ preventScroll: true })
  }
})

watch(() => [notes.currentId, ui.view], () => {
  // 阅读模式是「正在读的这篇」的状态：没有正文可读（无选中 / 回收站 / 监控页）就退出
  if (!notes.currentId || ui.view === 'metrics' || ui.view === 'trash') {
    ui.focusMode = false
    ui.readingMode = false
  }
})

async function focusSearch() {
  if (ui.workspacePage) await showNotes()
  ui.focusMode = false
  updateWorkspacePreferences({ listCollapsed: false })
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
  if (ui.view === 'knowledge-bases') { document.querySelector<HTMLInputElement>('.kb-search input')?.focus(); return }
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
  if (!hasToken.value || e.defaultPrevented || e.isComposing || document.querySelector('[aria-modal="true"], [role="menu"]')) return
  if (e.key === 'Escape' && (ui.drawerOpen || (!ui.workspacePage && (ui.focusMode || ui.readingMode)))) {
    e.preventDefault()
    e.stopPropagation()
    // 由外到内：抽屉 -> 阅读模式 -> 专注模式
    if (ui.drawerOpen) ui.drawerOpen = false
    else if (ui.readingMode) ui.readingMode = false
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
  if (ui.workspacePage && action.type !== 'openSettings' && action.type !== 'focusSearch') return
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
  notes.open(list[next].id)
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
    // 阅读模式是纯界面状态；只加请求计数，由 NoteDetail 负责「先落盘再只读」
    case 'toggleReading': if (editable) ui.readingRequest += 1; return
    // 删除仍要走确认弹窗：计数加一，NoteDetail 监听到就弹出与鼠标路径相同的确认框
    case 'trash': if (editable) ui.trashRequest += 1; return
    case 'nextNote': stepNote(1); return
    case 'prevNote': stepNote(-1); return
    case 'toggleFocus': if (editable) ui.focusMode = !ui.focusMode; return
    case 'syncNow': await retrySyncNow(); return
    case 'openSettings': openWorkspacePage('settings'); return
  }
}

onMounted(() => {
  // 先处理界面快捷键，避免编辑器的 Escape / Mod-K 抢走专注与搜索操作。
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', updateViewport)
  // main.ts 已在取数前恢复导航；独立挂载 App 时也初始化，重复调用不会覆盖状态。
  initNavigation()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', updateViewport)
})
</script>

<template>
  <TokenGate v-if="!hasToken" />

  <div v-else class="layout" :class="{ 'is-focused': ui.focusMode, 'is-sidebar-collapsed': preferences.sidebarCollapsed, 'is-list-collapsed': listCollapsed, 'is-library-list': ui.view === 'knowledge-bases' && !ui.activeKnowledgeBaseId, 'is-utility-page': !!ui.workspacePage }" :style="{ '--preferred-sidebar-width': `${preferences.sidebarWidth}px`, '--preferred-list-width': `${listWidth}px` }" :data-mobile-pane="ui.mobilePane" :data-view="ui.workspacePage ?? ui.view">
    <!-- 窄屏将分组导航收进抽屉，搜索仍留在笔记列表上方。 -->
    <aside id="workspace-sidebar" class="sidebar-pane" :class="{ 'is-open': ui.drawerOpen }" :inert="compact && !ui.drawerOpen">
      <GroupSidebar />
    </aside>
    <Transition name="veil"><div v-if="ui.drawerOpen" class="drawer-mask" @click="ui.drawerOpen = false"></div></Transition>

    <section id="workspace-list" v-show="!ui.workspacePage" class="list-pane" :aria-label="ui.view === 'knowledge-bases' ? '笔记本工作区' : '便签目录'" :inert="!!ui.workspacePage || (compact && ui.drawerOpen)">
      <MetricsView v-if="ui.view === 'metrics'" />
      <TrashView v-else-if="ui.view === 'trash'" />
      <KnowledgeBaseWorkspace v-else-if="ui.view === 'knowledge-bases'" />
      <NoteList v-else />
    </section>
    <WorkspaceDivider v-if="!compact && !ui.focusMode && !preferences.sidebarCollapsed" pane="sidebar" label="调整侧栏宽度" controls="workspace-sidebar" :size="sidebarWidth" :min="WORKSPACE_WIDTHS.sidebar.min" :max="WORKSPACE_WIDTHS.sidebar.max" :default-size="WORKSPACE_WIDTHS.sidebar.default" @resize="updateWorkspacePreferences({ sidebarWidth: $event })" />
    <WorkspaceDivider v-if="!compact && !ui.focusMode && !listCollapsed && !ui.workspacePage && ui.view !== 'metrics' && !(ui.view === 'knowledge-bases' && !ui.activeKnowledgeBaseId)" pane="list" label="调整笔记列表宽度" controls="workspace-list" :size="listWidth" :min="WORKSPACE_WIDTHS.list.min" :max="listMax" :default-size="WORKSPACE_WIDTHS.list.default" @resize="updateWorkspacePreferences({ listWidth: $event })" />

    <!--
      回收站详情与编辑详情用同一个组件，只是 readonly 不同。
      key 区分两者：ProseMirror 的 editable 在建实例时读一次，不重挂就切不干净。
      监控页没有笔记详情；统计与设置页面都保留当前编辑器实例。
    -->
    <KnowledgeBaseHome v-if="ui.view === 'knowledge-bases' && ui.activeKnowledgeBaseId && !notes.currentId" v-show="!ui.workspacePage" :inert="!!ui.workspacePage || (compact && ui.drawerOpen)" />
    <NoteDetail
      v-else-if="ui.view !== 'metrics' && !(ui.view === 'knowledge-bases' && !ui.activeKnowledgeBaseId)"
      v-show="!ui.workspacePage"
      :key="ui.view === 'trash' ? 'trash' : 'main'"
      :readonly="ui.view === 'trash'"
      :inert="!!ui.workspacePage || (compact && ui.drawerOpen)"
      @back="backToList"
    />
    <StatsPage v-if="ui.workspacePage === 'stats'" :open="true" :inert="compact && ui.drawerOpen" />
    <SettingsPage v-if="ui.workspacePage === 'settings'" :open="true" :inert="compact && ui.drawerOpen" />
  </div>
  <Toast />
</template>
