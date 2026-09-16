<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { version as appVersion } from '../../package.json'
import { RELEASES_URL, checkForUpdate, updateInfo } from '../update-check'
import { openStats, showNotes, switchListView } from '../navigation'
import { syncNow } from '../sync/engine'
import AppIcon from './AppIcon.vue'
import GroupDialog from './GroupDialog.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { useWorkspaceScroll } from './useWorkspaceScroll'

const groups = useGroupsStore()
const notes = useNotesStore()
const ui = useUiStore()
const brandIconUrl = `${import.meta.env.BASE_URL}snotes.svg`
const inNotes = computed(() => ui.view !== 'metrics')
const groupList = ref<HTMLElement | null>(null)
useWorkspaceScroll(groupList, 'groups')

const versionOpen = ref(false)
const versionButton = ref<HTMLButtonElement | null>(null)
const versionCloseButton = ref<HTMLButtonElement | null>(null)
const versionLabel = `v${appVersion}`
const hasUpdate = computed(() => updateInfo.value?.hasUpdate === true)
const latestLabel = computed(() => (updateInfo.value ? `v${updateInfo.value.latest}` : null))
const releaseUrl = computed(() => hasUpdate.value ? updateInfo.value!.url : RELEASES_URL)
const versionDialog = ref<HTMLElement | null>(null)
const versionTitle = computed(() => (hasUpdate.value ? `有新版本 ${latestLabel.value} 可用，当前 ${versionLabel}` : `当前网页版本：${versionLabel}`))

const syncTitle = computed(() => {
  if (ui.syncing) return '正在同步…'
  if (ui.lastSyncError) return `同步失败：${ui.lastSyncError}，点击重试`
  if (ui.failedCount > 0) return `${ui.failedCount} 条改动未推送，点击同步`
  return '立即同步'
})

const online = ref(navigator.onLine)
function updateOnline() { online.value = navigator.onLine }
onMounted(() => {
  void checkForUpdate()
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
})
onUnmounted(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})
const syncLabel = computed(() => {
  if (!online.value) return '离线可用'
  if (ui.syncing) return '正在同步'
  if (ui.failedCount > 0 || ui.lastSyncError) return '同步待重试'
  return '自动同步'
})

function onVersionKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    event.preventDefault()
    versionOpen.value = false
  } else if (event.key === 'Tab') {
    const controls = versionDialog.value?.querySelectorAll<HTMLElement>('a[href], button')
    const first = controls?.[0]
    const last = controls?.[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
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
  <nav class="group-sidebar" :class="{ 'rail-only': !inNotes }" aria-label="便签导航">
    <div class="app-rail">
      <img class="brand-mark" :src="brandIconUrl" alt="" width="30" height="30" />
      <button v-if="!inNotes" class="sidebar-close rail-close icon-button" aria-label="关闭侧栏" title="关闭侧栏" @click="ui.drawerOpen = false"><AppIcon name="close" /></button>
      <button class="rail-button" type="button" :class="{ active: inNotes }" :aria-pressed="inNotes" title="笔记" aria-label="笔记" @click="showNotes">
        <AppIcon name="notes" :size="20" /><span class="rail-label">笔记</span>
      </button>
      <button class="rail-button" type="button" data-view="stats" :class="{ active: ui.statsOpen }" aria-haspopup="dialog" :aria-expanded="ui.statsOpen" title="记录统计" aria-label="记录统计" @click="openStats">
        <AppIcon name="chart" :size="20" /><span class="rail-label">统计</span>
      </button>
    </div>

    <div v-if="inNotes" class="sidebar-content">
      <div class="sidebar-brand">
        <span class="brand-name">snotes</span>
        <button class="sidebar-close icon-button" aria-label="关闭侧栏" title="关闭侧栏" @click="ui.drawerOpen = false"><AppIcon name="close" /></button>
      </div>

      <ul class="views">
        <li data-view="all" :class="{ active: ui.view === 'all' }" @click="switchListView('all')">
          <button type="button" :aria-current="ui.view === 'all' ? 'page' : undefined"><AppIcon name="notes" /><span>全部笔记</span><span v-if="ui.view === 'all' && !notes.stale" class="nav-count">{{ notes.notes.length }}</span></button>
        </li>
        <li data-view="star" :class="{ active: ui.view === 'star' }" @click="switchListView('star')">
          <button type="button" :aria-current="ui.view === 'star' ? 'page' : undefined"><AppIcon name="star" /><span>星标笔记</span></button>
        </li>
        <li data-view="trash" :class="{ active: ui.view === 'trash' }" @click="switchListView('trash')">
          <button type="button" :aria-current="ui.view === 'trash' ? 'page' : undefined"><AppIcon name="trash" /><span>回收站</span></button>
        </li>
      </ul>

      <div class="group-header">
        <span>分组</span>
        <button class="group-add" title="新建分组" aria-label="新建分组" @click="openCreate">
          <AppIcon name="plus" :size="15" />
        </button>
      </div>

      <ul ref="groupList" class="groups">
        <li
          v-for="group in groups.groups"
          :key="group.group_id"
          :data-group-id="group.group_id"
          :class="{ active: ui.activeGroupId === group.group_id }"
          @click="switchListView('group', group.group_id)"
        >
          <button class="group-link" type="button" :aria-current="ui.activeGroupId === group.group_id ? 'page' : undefined">
            <AppIcon name="folder" :size="16" class="group-icon" :style="group.color ? { color: group.color } : undefined" />
            <span class="group-name">{{ group.name }}</span>
          </button>
          <button class="rename-btn" title="重命名" aria-label="重命名" @click.stop="openRename(group.group_id)">
            <AppIcon name="more" :size="16" />
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
          <AppIcon v-else name="cloud" :size="16" />
          <span class="sync-label">{{ syncLabel }}</span>
          <span v-if="ui.failedCount > 0" class="failed-badge" aria-hidden="true">{{ ui.failedCount }}</span>
        </button>

        <button
          ref="versionButton"
          type="button"
          class="version-button"
          :title="versionTitle"
          :aria-label="hasUpdate ? `查看版本信息，有新版本 ${latestLabel} 可用` : `查看版本信息，当前版本 ${versionLabel}`"
          :class="{ 'has-update': hasUpdate }"
          aria-haspopup="dialog"
          :aria-expanded="versionOpen"
          @click="versionOpen = true"
        >
          {{ versionLabel }}
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="versionOpen" class="dialog-mask" @click.self="versionOpen = false">
        <div ref="versionDialog" class="dialog info-dialog" role="dialog" aria-modal="true" aria-label="版本信息">
          <h3 class="dialog-title">版本信息</h3>
          <ul class="info-list">
            <li><span class="info-label">应用名称</span><span class="info-value">snotes</span></li>
            <li><span class="info-label">网页版本</span><span class="info-value">{{ versionLabel }}</span></li>
            <li v-if="hasUpdate" class="update-row">
              <span class="info-label">最新版本</span>
              <span class="info-value">{{ latestLabel }}</span>
              <span class="info-sub">先按 README 的升级步骤保留自己的部署配置，再依次执行 <code>git pull --ff-only</code>、<code>npm ci</code>、<code>npx wrangler d1 migrations apply snotes --remote</code>、<code>npm run deploy</code>。数据库改过名时替换 <code>snotes</code>。</span>
            </li>
            <li v-else-if="latestLabel"><span class="info-label">最新版本</span><span class="info-value">{{ latestLabel }}</span><span class="info-sub">已是最新</span></li>
          </ul>
          <p class="update-links"><a :href="releaseUrl" target="_blank" rel="noopener noreferrer">{{ hasUpdate ? '查看发布说明' : '查看全部版本' }}</a></p>
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
