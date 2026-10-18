<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { isMobile, openDrawer, pushNav, switchListView } from '../navigation'
import EmptyState from './EmptyState.vue'
import ListSkeleton from './ListSkeleton.vue'
import NoteListItem from './NoteListItem.vue'
import ActionMenu from './ActionMenu.vue'
import AppIcon from './AppIcon.vue'
import NoteSearch from './NoteSearch.vue'
import SortMenu from './SortMenu.vue'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { useGroupsStore } from '../stores/groups'
import { homeHiddenGroupIds, isHiddenFromHome } from '../../shared/home-feed'
import type { LocalNote } from '../../shared/types'
import { useWorkspaceScroll } from './useWorkspaceScroll'
import { retrySyncNow } from '../sync/engine'
import { hasToken } from '../api/token'
import { notify } from '../notify'
import { workspacePreferences as preferences, updateWorkspacePreferences, type NoteSort } from '../workspace-preferences'

const notes = useNotesStore()
const groups = useGroupsStore()
const ui = useUiStore()
const groupNames = computed(() => new Map(groups.groups.map(g => [g.group_id, g.name])))
const list = ref<HTMLElement | null>(null)
useWorkspaceScroll(list, 'list')

const refreshing = ref(false)
const refreshBusy = computed(() => refreshing.value || ui.syncing)

async function refreshNotes() {
  if (refreshBusy.value) return
  if (!navigator.onLine) {
    notify('当前离线，联网后可刷新笔记')
    return
  }
  refreshing.value = true
  try {
    await retrySyncNow()
    if (!hasToken.value) return
    if (ui.lastSyncError) {
      notify(`刷新失败：${ui.lastSyncError}`)
      return
    }
    await Promise.all([notes.load(), groups.load()])
    notify(ui.failedCount > 0 ? '已刷新，仍有本地更改未同步' : '笔记已刷新')
  } catch (error) {
    notify(`刷新失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    refreshing.value = false
  }
}

// 左滑删除：pointer 事件记录起点，松手时按位移决定是否展开删除按钮。
const swipeStartX = ref<number | null>(null)
let swipeStartY = 0
let suppressClick = false
const swipedId = ref<string | null>(null)
const SWIPE_THRESHOLD = 40

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse') return
  swipeStartX.value = e.clientX
  swipeStartY = e.clientY
  suppressClick = false
}
function onPointerUp(e: PointerEvent, noteId: string) {
  if (swipeStartX.value === null) return
  const delta = e.clientX - swipeStartX.value
  if (Math.abs(e.clientY - swipeStartY) > Math.abs(delta)) {
    suppressClick = Math.abs(e.clientY - swipeStartY) > SWIPE_THRESHOLD
    swipeStartX.value = null
    return
  }
  if (delta < -SWIPE_THRESHOLD) swipedId.value = noteId
  else if (delta > SWIPE_THRESHOLD) swipedId.value = null
  suppressClick = Math.abs(delta) > SWIPE_THRESHOLD
  swipeStartX.value = null
}

const menuNote = ref<LocalNote | null>(null)
const menuAnchor = ref<HTMLElement | null>(null)
function openNoteMenu(note: LocalNote, event: MouseEvent) {
  menuNote.value = note
  menuAnchor.value = (event.currentTarget as HTMLElement).closest('.note-item')?.querySelector<HTMLElement>('.note-more') ?? event.currentTarget as HTMLElement
}
async function menuProps(props: Parameters<typeof notes.setProps>[1]) {
  const note = menuNote.value
  menuNote.value = null
  if (!note) return
  try { await notes.setProps(note.id, props) }
  catch (error) { notify(error instanceof Error ? error.message : String(error)) }
}
async function runTrash(id: string) {
  menuNote.value = null
  swipedId.value = null
  await notes.trashWithUndo(id)
}

/** 移动端进详情算一层界面切换，先入栈再换 currentId；桌面端两个面板同屏，不需入栈 */
function selectNote(id: string) {
  if (suppressClick) { suppressClick = false; return }
  if (swipedId.value) { swipedId.value = null; return }
  if (isMobile() && ui.mobilePane === 'list') pushNav()
  // open() 而不是直接写 currentId：只有用户点开才算一次「打开」，计入统计
  notes.open(id)
  if (isMobile()) ui.mobilePane = 'editor'
}

function focusFirst() {
  const first = notes.visible[0]
  if (!first) return
  selectNote(first.id)
  if (!isMobile()) document.querySelector<HTMLButtonElement>('.note-select')?.focus()
}

function onListKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const target = event.target as HTMLElement
  if (!target.matches('.note-select')) return
  const buttons = Array.from(target.closest('.note-list')!.querySelectorAll<HTMLButtonElement>('.note-select'))
  const index = buttons.indexOf(target as HTMLButtonElement)
  const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)]
  event.preventDefault()
  next?.focus()
  next?.click()
}

// 列表 header 视图标题：全部笔记 / 星标 / 分组名
const viewTitle = computed(() => {
  if (ui.view === 'star') return '星标'
  if (ui.view === 'hidden') return '已隐藏'
  if (ui.view === 'group') {
    const g = groups.groups.find((x) => x.group_id === ui.activeGroupId)
    return g?.name ?? '分组'
  }
  return '全部笔记'
})

/** 「不上首页」的分组集合；笔记是否隐藏由它和笔记自己的三态覆盖共同决定 */
const hiddenGroups = computed(() => homeHiddenGroupIds(groups.groups))

/** 列表里给不上首页的笔记打一个标记（「已隐藏」视图里全是它们，不重复标） */
function homeHiddenOf(note: LocalNote): boolean {
  return ui.view !== 'hidden' && isHiddenFromHome(note, hiddenGroups.value)
}

/**
 * 空态分五种：搜索无结果与「这个视图本来就没东西」是两回事，
 * 搜索无结果提供调整搜索的出口，新建统一使用顶部按钮。
 */
const empty = computed(() => {
  if (ui.query.trim()) {
    // 分组和星标视图只搜当前范围；搜不到时给一个跳去全部笔记继续找的出口
    const scoped = ui.view === 'group' || ui.view === 'star' || ui.view === 'hidden'
    return {
      title: `没有匹配「${ui.query.trim()}」的笔记`,
      hint: scoped ? `当前只在「${viewTitle.value}」里搜索` : '换个词试试，多个词用空格隔开',
      action: scoped ? '在全部笔记中搜索' : '清除搜索',
    }
  }
  if (ui.view === 'star') {
    return { title: '没有星标笔记', hint: '', action: '' }
  }
  if (ui.view === 'hidden') {
    return { title: '没有已隐藏的笔记', hint: '', action: '' }
  }
  if (ui.view === 'group') {
    return { title: `「${viewTitle.value}」里还没有笔记`, hint: '', action: '' }
  }
  return {
    title: '还没有笔记',
    hint: '',
    action: '',
  }
})

async function onEmptyAction() {
  if (empty.value.action === '清除搜索') ui.query = ''
  else if (empty.value.action === '在全部笔记中搜索') {
    const query = ui.query
    await switchListView('all')
    ui.query = query
  }
}

onMounted(() => {
  if (notes.stale) void notes.load()
})

watch(
  () => [ui.view, ui.activeGroupId],
  () => { if (notes.stale) void notes.load() }
)
</script>

<template>
  <div class="list-view">
    <!-- 窄屏显示抽屉入口，新建按钮始终可见。 -->
    <div class="list-header">
      <button class="drawer-btn" title="打开侧栏" aria-label="打开侧栏" @click="openDrawer()">
        <AppIcon name="menu" />
      </button>

      <span class="header-title" tabindex="-1" :title="viewTitle">{{ viewTitle }}</span>
      <span v-if="!notes.stale" class="header-count">{{ notes.visible.length }}</span>

      <button
        type="button"
        class="header-refresh"
        :title="refreshBusy ? '正在刷新' : '刷新笔记'"
        aria-label="刷新笔记"
        :aria-busy="refreshBusy"
        :disabled="refreshBusy"
        @click="refreshNotes"
      >
        <AppIcon name="refresh" :size="16" :class="{ 'sync-spinner': refreshBusy }" />
      </button>
      <button class="header-create" title="新建笔记" aria-label="新建笔记" @click="notes.create()">
        <AppIcon name="plus" :size="15" />
        <span>新建</span>
      </button>
    </div>

    <div class="list-search-tools">
      <NoteSearch @first="focusFirst" />
      <SortMenu label="笔记排序" :model-value="preferences.noteSort" :options="[{ value: 'updated', label: '最近更新' }, { value: 'created', label: '最近创建' }, { value: 'title', label: '标题顺序' }]" @update:model-value="updateWorkspacePreferences({ noteSort: $event as NoteSort })" />
    </div>
    <div v-if="ui.query.trim()" class="list-caption" aria-live="polite">
      <span>找到 {{ notes.visible.length }} 条笔记</span><button @click="ui.query = ''">清除筛选</button>
    </div>

    <ListSkeleton v-if="notes.stale" />

    <EmptyState
      v-else-if="notes.visible.length === 0"
      :title="empty.title"
      :hint="empty.hint"
      :action="empty.action"
      @action="onEmptyAction"
    />

    <ul v-else ref="list" class="note-list" aria-label="笔记列表" @keydown="onListKeydown">
      <NoteListItem
        v-for="note in notes.visible"
        :key="note.id"
        :note="note"
        :active="note.id === notes.currentId"
        :swiped="swipedId === note.id"
        :query="ui.query"
        :home-hidden="homeHiddenOf(note)"
        :group-name="note.group_id ? groupNames.get(note.group_id) : undefined"
        @click="selectNote(note.id)"
        @contextmenu.prevent="openNoteMenu(note, $event)"
        @pointerdown="onPointerDown"
        @pointerup="(e: PointerEvent) => onPointerUp(e, note.id)"
        @pointercancel="swipeStartX = null"
      >
        <template #actions>
          <button class="note-more" :aria-label="`笔记操作：${note.title || '无标题'}`" title="笔记操作" aria-haspopup="menu" :aria-expanded="menuNote?.id === note.id" @click.stop="openNoteMenu(note, $event)"><AppIcon name="more" :size="16" /></button>
          <button class="delete" title="删除" aria-label="删除" @click.stop="runTrash(note.id)">
            <AppIcon name="trash" :size="16" class="delete-icon" />
            <span class="delete-label">删除</span>
          </button>
        </template>
      </NoteListItem>
    </ul>

    <ActionMenu :open="!!menuNote" :anchor="menuAnchor" label="笔记操作" @close="menuNote = null">
      <template v-if="menuNote">
        <button class="menu-item" role="menuitemcheckbox" :aria-checked="menuNote.top === 1" @click="menuProps({ top: menuNote.top ? 0 : 1 })"><AppIcon name="pin" :size="15" />{{ menuNote.top ? '取消置顶' : '置顶' }}</button>
        <button class="menu-item" role="menuitemcheckbox" :aria-checked="menuNote.star === 1" @click="menuProps({ star: menuNote.star ? 0 : 1 })"><AppIcon name="star" :size="15" />{{ menuNote.star ? '取消星标' : '星标' }}</button>
        <span class="menu-separator" aria-hidden="true"></span>
        <span class="popover-heading">移至分组</span>
        <button class="menu-item" role="menuitemradio" :aria-checked="!menuNote.group_id" @click="menuProps({ group_id: null })">未分组</button>
        <button v-for="group in groups.groups" :key="group.group_id" class="menu-item" role="menuitemradio" :aria-checked="menuNote.group_id === group.group_id" @click="menuProps({ group_id: group.group_id })">{{ group.name }}</button>
        <span class="menu-separator" aria-hidden="true"></span>
        <button class="menu-item danger" role="menuitem" @click="runTrash(menuNote.id)"><AppIcon name="trash" :size="15" />移入回收站</button>
      </template>
    </ActionMenu>
  </div>
</template>
