<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { version as appVersion } from '../../package.json'
import type { ListView } from '../db/repo'
import { pushNav } from '../navigation'
import { syncNow } from '../sync/engine'
import GroupDialog from './GroupDialog.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'

const groups = useGroupsStore()
const notes = useNotesStore()
const ui = useUiStore()

const versionOpen = ref(false)
const versionButton = ref<HTMLButtonElement | null>(null)
const versionCloseButton = ref<HTMLButtonElement | null>(null)
const versionLabel = `v${appVersion}`

const syncTitle = computed(() => {
  if (ui.syncing) return '正在同步…'
  if (ui.lastSyncError) return `同步失败：${ui.lastSyncError}，点击重试`
  if (ui.failedCount > 0) return `${ui.failedCount} 条改动未推送，点击同步`
  return '立即同步'
})

function onVersionKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    event.preventDefault()
    versionOpen.value = false
  } else if (event.key === 'Tab') {
    event.preventDefault()
    versionCloseButton.value?.focus()
  }
}

watch(versionOpen, async (open) => {
  if (open) {
    window.addEventListener('keydown', onVersionKeydown, true)
    await nextTick()
    if (versionOpen.value) versionCloseButton.value?.focus()
  } else {
    window.removeEventListener('keydown', onVersionKeydown, true)
    versionButton.value?.focus()
  }
})

onUnmounted(() => window.removeEventListener('keydown', onVersionKeydown, true))

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
      <button
        type="button"
        class="sync-idle"
        :class="{ 'has-failed': ui.failedCount > 0 || ui.lastSyncError, 'is-syncing': ui.syncing }"
        :title="syncTitle"
        :aria-label="syncTitle"
        :aria-busy="ui.syncing"
        :disabled="ui.syncing"
        @click="syncNow()"
      >
        <svg v-if="ui.syncing" class="sync-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" opacity="0.25" />
          <path d="M12 3a9 9 0 019 9" stroke-linecap="round" />
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M17.5 19a4.5 4.5 0 100-9 6 6 0 00-11.7 1.5A4 4 0 006 19h11.5z" />
        </svg>
        <span v-if="ui.failedCount > 0" class="failed-badge" aria-hidden="true">{{ ui.failedCount }}</span>
      </button>

      <button
        ref="versionButton"
        type="button"
        class="version-button"
        :title="`当前网页版本：${versionLabel}`"
        :aria-label="`查看版本信息，当前版本 ${versionLabel}`"
        aria-haspopup="dialog"
        :aria-expanded="versionOpen"
        @click="versionOpen = true"
      >
        {{ versionLabel }}
      </button>
    </div>

    <Teleport to="body">
      <div v-if="versionOpen" class="dialog-mask" @click.self="versionOpen = false">
        <div class="dialog info-dialog" role="dialog" aria-modal="true" aria-label="版本信息">
          <h3 class="dialog-title">版本信息</h3>
          <ul class="info-list">
            <li><span class="info-label">应用名称</span><span class="info-value">snotes</span></li>
            <li><span class="info-label">网页版本</span><span class="info-value">{{ versionLabel }}</span></li>
          </ul>
          <p class="confirm-message">此版本号对应当前加载的网页。</p>
          <div class="dialog-footer">
            <button ref="versionCloseButton" type="button" class="dialog-btn ok" @click="versionOpen = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>

    <GroupDialog
      :open="dialogOpen"
      :title="dialogTitle"
      :initial="dialogInitial"
      @submit="submitDialog"
      @close="dialogOpen = false"
    />
  </nav>
</template>
