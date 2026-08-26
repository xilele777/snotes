<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ListView } from '../db/repo'
import { pushNav } from '../navigation'
import GroupDialog from './GroupDialog.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'

const groups = useGroupsStore()
const notes = useNotesStore()
const ui = useUiStore()

/** null = 新建，字符串 = 正在重命名的 group_id；两种模式复用同一个弹窗 */
const editingId = ref<string | null>(null)
const dialogOpen = ref(false)

const dialogTitle = computed(() => (editingId.value === null ? '新建分组' : '重命名'))
const dialogInitial = computed(
  () => groups.groups.find((g) => g.group_id === editingId.value)?.name ?? ''
)

onMounted(() => groups.load())

async function switchView(view: ListView, groupId: string | null = null) {
  if (ui.view === view && ui.activeGroupId === groupId) return
  // Bug 2：视图切换是一层界面变化，先入栈；返回时能回到上一个视图
  pushNav()
  ui.view = view
  ui.activeGroupId = groupId
  // 抽屉态下选完就该收起来，否则遮罩一直盖着刚切过去的列表
  ui.drawerOpen = false
  await notes.load()
}

/** 监控页没有笔记列表，不触发 notes.load()，也不该被 listNotes 的 ListView 过滤打扰 */
function goMetrics() {
  if (ui.view === 'metrics') return
  pushNav()
  ui.view = 'metrics'
  ui.activeGroupId = null
  ui.drawerOpen = false
}

/** 统计页同样是全屏视图，不触发 notes.load() */
function goStats() {
  if (ui.view === 'stats') return
  pushNav()
  ui.view = 'stats'
  ui.activeGroupId = null
  ui.drawerOpen = false
}

function openCreate() {
  editingId.value = null
  dialogOpen.value = true
}

function openRename(groupId: string) {
  editingId.value = groupId
  dialogOpen.value = true
}

async function submitDialog(name: string) {
  if (editingId.value === null) await groups.create(name)
  else await groups.rename(editingId.value, name)
  dialogOpen.value = false
}
</script>

<template>
  <nav class="group-sidebar">
    <div class="sidebar-search">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input v-model="ui.query" type="search" placeholder="搜索笔记" />
    </div>

    <ul class="views">
      <li data-view="all" :class="{ active: ui.view === 'all' }" @click="switchView('all')">
        全部笔记
      </li>
      <li data-view="star" :class="{ active: ui.view === 'star' }" @click="switchView('star')">
        星标
      </li>
      <li data-view="trash" :class="{ active: ui.view === 'trash' }" @click="switchView('trash')">
        回收站
      </li>
      <li data-view="stats" :class="{ active: ui.view === 'stats' }" @click="goStats">
        统计
      </li>
    </ul>

    <div class="group-header">
      <span>分组</span>
      <button class="group-add" title="新建分组" aria-label="新建分组" @click="openCreate">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>

    <ul class="groups">
      <li
        v-for="group in groups.groups"
        :key="group.group_id"
        :data-group-id="group.group_id"
        :class="{ active: ui.activeGroupId === group.group_id }"
        @click="switchView('group', group.group_id)"
      >
        <span class="dot" :style="group.color ? { backgroundColor: group.color } : undefined"></span>
        <span class="group-name">{{ group.name }}</span>
        <button class="rename-btn" title="重命名" aria-label="重命名" @click.stop="openRename(group.group_id)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
          </svg>
        </button>
      </li>
    </ul>

    <div class="user-area">
      <!-- 同步状态指示，Task 20 接线后由 ui.syncing/failedCount 驱动 -->
      <span
        class="sync-idle"
        :class="{ 'has-failed': ui.failedCount > 0 }"
        :title="ui.failedCount > 0 ? `${ui.failedCount} 条改动未推送` : ''"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17.5 19a4.5 4.5 0 100-9 6 6 0 00-11.7 1.5A4 4 0 006 19h11.5z" />
        </svg>
        <span v-if="ui.failedCount > 0" class="failed-badge">{{ ui.failedCount }}</span>
      </span>

      <!-- 数据监控入口（Bug 8）：云端同步图标旁边 -->
      <button
        class="metrics-entry"
        :class="{ active: ui.view === 'metrics' }"
        data-view="metrics"
        title="数据监控"
        aria-label="数据监控"
        @click="goMetrics"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 15l4-5 3 3 5-7" />
        </svg>
      </button>
    </div>

    <GroupDialog
      :open="dialogOpen"
      :title="dialogTitle"
      :initial="dialogInitial"
      @submit="submitDialog"
      @close="dialogOpen = false"
    />
  </nav>
</template>
