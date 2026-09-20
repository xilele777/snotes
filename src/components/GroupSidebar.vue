<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { checkForUpdate, updateInfo } from '../update-check'
import { openOverlay, showNotes, switchListView } from '../navigation'
import { syncNow } from '../sync/engine'
import AppIcon from './AppIcon.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import GroupDialog from './GroupDialog.vue'
import GroupMenu from './GroupMenu.vue'
import type { Group } from '../../shared/types'
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

/** 更新提示点挂在图标栏「设置」上；版本号本身在设置的「关于」页里看 */
const hasUpdate = computed(() => updateInfo.value?.hasUpdate === true)
const latestLabel = computed(() => (updateInfo.value ? `v${updateInfo.value.latest}` : null))
const settingsOpen = computed(() => ui.overlay === 'settings')
const statsOpen = computed(() => ui.overlay === 'stats')

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

/** 分组行「⋯」菜单：重命名、标记颜色、上移下移、删除 */
const menuGroup = ref<Group | null>(null)
const menuAnchor = ref<HTMLElement | null>(null)
const menuIndex = computed(() => groups.groups.findIndex((g) => g.group_id === menuGroup.value?.group_id))

function toggleMenu(group: Group, event: MouseEvent) {
  if (menuGroup.value?.group_id === group.group_id) {
    closeMenu()
    return
  }
  menuAnchor.value = event.currentTarget as HTMLElement
  menuGroup.value = group
}

/** 关菜单时同步把焦点交还给触发按钮；随后打开的弹窗会记住它，关闭后焦点仍回到这一行 */
function closeMenu() {
  if (!menuGroup.value) return
  menuGroup.value = null
  menuAnchor.value?.focus({ preventScroll: true })
}

/** 取走菜单指向的分组并收起菜单，各动作只处理自己的事 */
function takeMenuGroup(): Group | null {
  const group = menuGroup.value
  closeMenu()
  return group
}

function menuRename() {
  const group = takeMenuGroup()
  if (group) openRename(group.group_id)
}

async function menuColor(color: string | null) {
  const group = takeMenuGroup()
  if (group) await groups.setColor(group.group_id, color)
}

async function menuMove(delta: -1 | 1) {
  const group = takeMenuGroup()
  if (group) await groups.move(group.group_id, delta)
}

const confirmRemove = ref<Group | null>(null)

function menuRemove() {
  confirmRemove.value = takeMenuGroup()
}

/** 删除后组内笔记回到未分组；正看着这个分组时切回全部笔记，否则刷新列表里的分组标签 */
async function runRemove() {
  const group = confirmRemove.value
  confirmRemove.value = null
  if (!group) return
  await groups.remove(group.group_id)
  if (ui.view === 'group' && ui.activeGroupId === group.group_id) await switchListView('all')
  else await notes.load()
}

// 抽屉收起时菜单没有锚点可贴，一并收掉
watch(() => ui.drawerOpen, (open) => { if (!open) menuGroup.value = null })
</script>

<template>
  <nav class="group-sidebar" :class="{ 'rail-only': !inNotes }" aria-label="便签导航">
    <div class="app-rail">
      <img class="brand-mark" :src="brandIconUrl" alt="" width="30" height="30" />
      <button v-if="!inNotes" class="sidebar-close rail-close icon-button" aria-label="关闭侧栏" title="关闭侧栏" @click="ui.drawerOpen = false"><AppIcon name="close" /></button>
      <button class="rail-button" type="button" :class="{ active: inNotes }" :aria-pressed="inNotes" title="笔记" aria-label="笔记" @click="showNotes">
        <AppIcon name="notes" :size="20" /><span class="rail-label">笔记</span>
      </button>
      <button class="rail-button" type="button" data-view="stats" :class="{ active: statsOpen }" aria-haspopup="dialog" :aria-expanded="statsOpen" title="记录统计" aria-label="记录统计" @click="openOverlay('stats')">
        <AppIcon name="chart" :size="20" /><span class="rail-label">统计</span>
      </button>
      <!-- 应用级入口放在栏底：与「统计」同级，不混进上面的笔记筛选项；抽屉里带文字标签 -->
      <button
        class="rail-button rail-settings"
        type="button"
        data-view="settings"
        :class="{ active: settingsOpen, 'has-update': hasUpdate }"
        aria-haspopup="dialog"
        :aria-expanded="settingsOpen"
        :title="hasUpdate ? `设置（有新版本 ${latestLabel} 可用）` : '设置'"
        aria-label="设置"
        @click="openOverlay('settings')"
      >
        <AppIcon name="sliders" :size="20" /><span class="rail-label">设置</span>
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
          :class="{ active: ui.activeGroupId === group.group_id, 'menu-open': menuGroup?.group_id === group.group_id }"
          @click="switchListView('group', group.group_id)"
        >
          <button class="group-link" type="button" :aria-current="ui.activeGroupId === group.group_id ? 'page' : undefined">
            <AppIcon name="folder" :size="16" class="group-icon" :style="group.color ? { color: group.color } : undefined" />
            <span class="group-name">{{ group.name }}</span>
          </button>
          <button
            class="group-menu-btn"
            type="button"
            title="分组操作"
            :aria-label="`分组「${group.name}」操作`"
            aria-haspopup="menu"
            :aria-expanded="menuGroup?.group_id === group.group_id"
            @click.stop="toggleMenu(group, $event)"
          >
            <AppIcon name="more" :size="16" />
          </button>
        </li>
      </ul>

      <!-- 底部只留同步状态与版本号；导出导入、外观等都进了图标栏的「设置」 -->
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

      </div>
    </div>

    <GroupDialog
      :open="dialogOpen"
      :title="dialogTitle"
      :initial="dialogInitial"
      @submit="submitDialog"
      @close="dialogOpen = false"
    />

    <GroupMenu
      :group="menuGroup"
      :anchor="menuAnchor"
      :can-move-up="menuIndex > 0"
      :can-move-down="menuIndex >= 0 && menuIndex < groups.groups.length - 1"
      @rename="menuRename"
      @color="menuColor"
      @move="menuMove"
      @remove="menuRemove"
      @close="closeMenu"
    />

    <!-- 与 GroupDialog 同理，遮罩必须 Teleport 出侧栏，否则会被抽屉的 transform 裁掉 -->
    <Teleport to="body">
      <ConfirmDialog
        :open="confirmRemove !== null"
        :title="`删除分组「${confirmRemove?.name ?? ''}」？`"
        message="组内笔记会回到未分组，不会被删除。"
        confirm-text="删除"
        @confirm="runRemove"
        @cancel="confirmRemove = null"
      />
    </Teleport>
  </nav>
</template>
