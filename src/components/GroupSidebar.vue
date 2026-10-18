<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { checkForUpdate, updateInfo } from '../update-check'
import { openWorkspacePage, showKnowledgeBases, showNotes, switchListView } from '../navigation'
import { retrySyncNow } from '../sync/engine'
import { notify } from '../notify'
import AppIcon from './AppIcon.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import GroupDialog from './GroupDialog.vue'
import GroupMenu from './GroupMenu.vue'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import { workspacePreferences as preferences, updateWorkspacePreferences } from '../workspace-preferences'
import type { Group } from '../../shared/types'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { useWorkspaceScroll } from './useWorkspaceScroll'

const groups = useGroupsStore()
const notes = useNotesStore()
const ui = useUiStore()
const libraries = useKnowledgeBasesStore()
defineEmits<{ search: [] }>()
const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
const brandIconUrl = `${import.meta.env.BASE_URL}snotes.svg`
const groupList = ref<HTMLElement | null>(null)
useWorkspaceScroll(groupList, 'groups')
const books = computed(() => libraries.books.filter(b => !b.invalid))
const quickBooks = computed(() => [...books.value].sort((a, b) => Number(preferences.value.pinnedKnowledgeBaseIds.includes(b.id)) - Number(preferences.value.pinnedKnowledgeBaseIds.includes(a.id)) || b.update_time - a.update_time || a.id.localeCompare(b.id)).slice(0, 5))
async function quickCreate() {
  try {
    if (ui.workspacePage) await showNotes()
    if (ui.view === 'knowledge-bases' && !ui.activeKnowledgeBaseId) await switchListView('all')
    ui.drawerOpen = false
    ui.focusMode = false
    updateWorkspacePreferences({ listCollapsed: false })
    await notes.create()
  } catch (error) { notify(error instanceof Error ? error.message : String(error)) }
}
let catalog: ReturnType<typeof libraries.subscribeCatalog> | undefined
onMounted(() => { catalog = libraries.subscribeCatalog() })
onUnmounted(() => catalog?.unsubscribe())

/** 更新提示点挂在侧栏「设置」上；版本号在设置的「关于」页里看。 */
const hasUpdate = computed(() => updateInfo.value?.hasUpdate === true)
const latestLabel = computed(() => (updateInfo.value ? `v${updateInfo.value.latest}` : null))
const settingsOpen = computed(() => ui.workspacePage === 'settings')
const statsOpen = computed(() => ui.workspacePage === 'stats')
const syncError = computed(() => ui.lastSyncError || ui.knowledgeBaseSyncError)

const syncTitle = computed(() => {
  if (ui.syncing) return '正在同步…'
  if (syncError.value) return `同步失败：${syncError.value}，点击重试`
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
  if (ui.failedCount > 0 || syncError.value) return '同步待重试'
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

/** 分组级「不上首页信息流」：打开状态那一刻的组内笔记会立刻跟着变（笔记级覆盖除外） */
async function menuHomeFeed(hidden: boolean) {
  const group = takeMenuGroup()
  if (!group) return
  await groups.setHomeFeedHidden(group.group_id, hidden)
  notify(hidden ? `「${group.name}」的笔记不再上首页` : `「${group.name}」的笔记恢复上首页`)
  // 首页信息流的筛选结果变了：正看着「全部笔记」或「已隐藏」时要刷新列表
  if (ui.view === 'all' || ui.view === 'hidden') await notes.load()
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
  <nav class="group-sidebar" aria-label="便签导航">
    <div class="sidebar-content">
      <div class="sidebar-brand">
        <button class="brand-home" aria-label="笔记" title="回到上次的笔记位置" @click="showNotes"><img class="brand-mark" :src="brandIconUrl" alt="" width="26" height="26" /><span class="brand-name">snotes</span></button>
        <button class="sidebar-toggle icon-button" :aria-label="preferences.sidebarCollapsed ? '展开侧栏' : '收起侧栏'" :title="preferences.sidebarCollapsed ? '展开侧栏' : '收起侧栏'" :aria-expanded="!preferences.sidebarCollapsed" @click="updateWorkspacePreferences({ sidebarCollapsed: !preferences.sidebarCollapsed })"><AppIcon name="sidebar" :size="18" /></button>
        <button class="sidebar-close icon-button" aria-label="关闭侧栏" title="关闭侧栏" @click="ui.drawerOpen = false"><AppIcon name="close" /></button>
      </div>

      <div class="sidebar-actions">
        <button type="button" class="sidebar-create" aria-label="快速新建笔记" title="在当前工作区新建笔记 (Alt N)" @click="quickCreate"><AppIcon name="plus" :size="18" /><span>新建笔记</span><kbd>Alt N</kbd></button>
        <button type="button" class="sidebar-search" aria-label="搜索工作区" title="搜索当前工作区" @click="$emit('search')"><AppIcon name="search" :size="17" /><span>搜索</span><kbd>{{ searchShortcut }}</kbd></button>
      </div>
      <div class="nav-section-label">我的笔记</div>
      <ul class="views">
        <li data-view="all" :class="{ active: !ui.workspacePage && ui.view === 'all' }" @click="switchListView('all')">
          <button type="button" aria-label="全部笔记" title="全部笔记" :aria-current="!ui.workspacePage && ui.view === 'all' ? 'page' : undefined"><AppIcon name="notes" /><span>全部笔记</span><span v-if="ui.view === 'all' && !notes.stale" class="nav-count">{{ notes.notes.length }}</span></button>
        </li>
        <li data-view="star" :class="{ active: !ui.workspacePage && ui.view === 'star' }" @click="switchListView('star')">
          <button type="button" aria-label="星标笔记" title="星标笔记" :aria-current="!ui.workspacePage && ui.view === 'star' ? 'page' : undefined"><AppIcon name="star" /><span>星标笔记</span></button>
        </li>
        <li data-view="hidden" :class="{ active: !ui.workspacePage && ui.view === 'hidden' }" @click="switchListView('hidden')">
          <button type="button" aria-label="已隐藏笔记" title="已隐藏笔记" :aria-current="!ui.workspacePage && ui.view === 'hidden' ? 'page' : undefined"><AppIcon name="eyeOff" /><span>已隐藏笔记</span></button>
        </li>
        <li class="notebook-entry" data-view="knowledge-bases" :class="{ active: !ui.workspacePage && ui.view === 'knowledge-bases' }" @click="showKnowledgeBases()">
          <button type="button" aria-label="笔记本" title="笔记本" :aria-current="!ui.workspacePage && ui.view === 'knowledge-bases' ? 'page' : undefined"><AppIcon name="book" /><span>笔记本</span><span v-if="books.length" class="nav-count">{{ books.length }}</span></button>
        </li>
      </ul>
      <div ref="groupList" class="sidebar-scroll">
      <div class="group-header">
        <button class="section-toggle" title="按分组筛选笔记" :aria-expanded="!preferences.groupsCollapsed" aria-controls="sidebar-groups" :aria-label="preferences.groupsCollapsed ? '展开分组' : '折叠分组'" @click="updateWorkspacePreferences({ groupsCollapsed: !preferences.groupsCollapsed })"><AppIcon name="chevron" :size="12" :class="{ expanded: !preferences.groupsCollapsed }" /><span>分组</span><span class="section-count">{{ groups.groups.length }}</span></button>
        <button class="group-add" title="新建分组" aria-label="新建分组" @click="openCreate">
          <AppIcon name="plus" :size="15" />
        </button>
      </div>

      <ul v-show="!preferences.groupsCollapsed || preferences.sidebarCollapsed" id="sidebar-groups" class="groups">
        <li
          v-for="group in groups.groups"
          :key="group.group_id"
          :data-group-id="group.group_id"
          :class="{ active: !ui.workspacePage && ui.view === 'group' && ui.activeGroupId === group.group_id, 'menu-open': menuGroup?.group_id === group.group_id }"
          @click="switchListView('group', group.group_id)"
        >
          <button class="group-link" type="button" :title="group.name" :aria-label="group.name" :aria-current="!ui.workspacePage && ui.view === 'group' && ui.activeGroupId === group.group_id ? 'page' : undefined">
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
      <section v-if="books.length" class="sidebar-notebooks" aria-label="常用笔记本">
        <div class="library-header"><button class="section-toggle" :aria-expanded="!preferences.librariesCollapsed" aria-controls="sidebar-books" :aria-label="preferences.librariesCollapsed ? '展开常用笔记本' : '折叠常用笔记本'" @click="updateWorkspacePreferences({ librariesCollapsed: !preferences.librariesCollapsed })"><AppIcon name="chevron" :size="12" :class="{ expanded: !preferences.librariesCollapsed }" /><span>常用笔记本</span></button></div>
        <ul v-show="!preferences.librariesCollapsed || preferences.sidebarCollapsed" id="sidebar-books" class="groups notebook-shortcuts">
          <li v-for="b in quickBooks" :key="b.id" :class="{ active: !ui.workspacePage && ui.view === 'knowledge-bases' && ui.activeKnowledgeBaseId === b.id }">
            <button type="button" class="group-link" :title="b.name" :aria-label="`打开笔记本：${b.name}`" :aria-current="!ui.workspacePage && ui.view === 'knowledge-bases' && ui.activeKnowledgeBaseId === b.id ? 'page' : undefined" @click="showKnowledgeBases(b.id)"><AppIcon :name="preferences.pinnedKnowledgeBaseIds.includes(b.id) ? 'pin' : 'book'" :size="17" class="group-icon" /><span class="group-name">{{ b.name }}</span></button>
          </li>
        </ul>
      </section>
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-tools">
          <button class="sidebar-tool" data-view="trash" :class="{ active: !ui.workspacePage && ui.view === 'trash' }" aria-label="回收站" title="回收站" :aria-current="!ui.workspacePage && ui.view === 'trash' ? 'page' : undefined" @click="switchListView('trash')"><AppIcon name="trash" :size="16" /><span>回收站</span></button>
          <button class="sidebar-tool" data-view="stats" :class="{ active: statsOpen }" aria-label="统计" title="统计" :aria-current="statsOpen ? 'page' : undefined" @click="openWorkspacePage('stats')"><AppIcon name="chart" :size="16" /><span>统计</span></button>
          <button class="sidebar-tool" data-view="settings" :class="{ active: settingsOpen, 'has-update': hasUpdate }" aria-label="设置" :aria-current="settingsOpen ? 'page' : undefined" :title="hasUpdate ? `设置（有新版本 ${latestLabel} 可用）` : '设置'" @click="openWorkspacePage('settings')"><AppIcon name="settings" :size="20" /><span>设置</span></button>
        </div>

      <!-- 同步状态在所有工作区保持可见。 -->
      <div class="user-area">
        <button
          type="button"
          class="sync-idle"
          :class="{ 'has-failed': ui.failedCount > 0 || syncError, 'is-syncing': ui.syncing }"
          :title="syncTitle"
          :aria-label="syncTitle"
          :aria-busy="ui.syncing"
          :disabled="ui.syncing"
          @click="retrySyncNow()"
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
      @home-feed="menuHomeFeed"
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
