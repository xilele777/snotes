<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { hasToken } from './api/token'
import GroupSidebar from './components/GroupSidebar.vue'
import MetricsView from './components/MetricsView.vue'
import NoteDetail from './components/NoteDetail.vue'
import NoteList from './components/NoteList.vue'
import TokenGate from './components/TokenGate.vue'
import TrashView from './components/TrashView.vue'
import { resolveShortcut } from './components/shortcut'
import { backToList, initNavigation, openDrawer } from './navigation'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'

const notes = useNotesStore()
const ui = useUiStore()

// 移动端 <720px 列表↔编辑器互斥（UI 规格 §2.3）。状态在 ui store 里，
// 导航快照（Bug 2）要靠它保存/恢复。
watch(
  () => notes.currentId,
  (id) => {
    ui.mobilePane = id ? 'editor' : 'list'
  }
)

// 全局快捷键（UI 规格 §6.2）
function onKeydown(e: KeyboardEvent) {
  const action = resolveShortcut(e, { hasQuery: ui.query.trim().length > 0 })
  if (!action) return

  if (action.type === 'create') {
    e.preventDefault()
    notes.create()
  } else if (action.type === 'focusSearch') {
    e.preventDefault()
    // 抽屉态下搜索框藏在侧栏里，得先把侧栏推出来才聚焦得到
    openDrawer()
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('.sidebar-search input')?.focus()
    })
  } else if (action.type === 'clearQuery') {
    e.preventDefault()
    ui.query = ''
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // Bug 2：启动时 replaceState 根快照，根界面按返回不退出应用
  initNavigation()
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <TokenGate v-if="!hasToken" />

  <div v-else class="layout" :data-mobile-pane="ui.mobilePane">
    <!-- ≤1020px 侧栏变抽屉：不给入口的话搜索、星标、回收站、分组会整体失联 -->
    <aside class="sidebar-pane" :class="{ 'is-open': ui.drawerOpen }">
      <GroupSidebar />
    </aside>
    <div v-if="ui.drawerOpen" class="drawer-mask" @click="ui.drawerOpen = false"></div>

    <section class="list-pane">
      <MetricsView v-if="ui.view === 'metrics'" />
      <TrashView v-else-if="ui.view === 'trash'" />
      <NoteList v-else />
    </section>

    <!--
      回收站详情与编辑详情用同一个组件，只是 readonly 不同。
      key 区分两者：ProseMirror 的 editable 在建实例时读一次，不重挂就切不干净。
      监控页没有笔记详情，details 区整块隐藏。
    -->
    <NoteDetail
      v-if="ui.view !== 'metrics'"
      :key="ui.view === 'trash' ? 'trash' : 'main'"
      :readonly="ui.view === 'trash'"
      @back="backToList"
    />
  </div>
</template>
