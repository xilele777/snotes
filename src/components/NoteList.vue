<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { isMobile, openDrawer, pushNav } from '../navigation'
import EmptyState from './EmptyState.vue'
import ListSkeleton from './ListSkeleton.vue'
import NoteListItem from './NoteListItem.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import AppIcon from './AppIcon.vue'
import NoteSearch from './NoteSearch.vue'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { useGroupsStore } from '../stores/groups'
import { useWorkspaceScroll } from './useWorkspaceScroll'

const notes = useNotesStore()
const groups = useGroupsStore()
const ui = useUiStore()
const groupNames = computed(() => new Map(groups.groups.map(g => [g.group_id, g.name])))
const list = ref<HTMLElement | null>(null)
useWorkspaceScroll(list, 'list')

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

/** 左滑删除也要过确认弹窗（Bug 4） */
const confirmTrashId = ref<string | null>(null)
function runTrash() {
  if (confirmTrashId.value !== null) {
    notes.trash(confirmTrashId.value)
    swipedId.value = null
  }
  confirmTrashId.value = null
}

/** 移动端进详情算一层界面切换，先入栈再换 currentId；桌面端两个面板同屏，不需入栈 */
function selectNote(id: string) {
  if (suppressClick) { suppressClick = false; return }
  if (swipedId.value) { swipedId.value = null; return }
  if (isMobile() && ui.mobilePane === 'list') pushNav()
  notes.currentId = id
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
  if (ui.view === 'group') {
    const g = groups.groups.find((x) => x.group_id === ui.activeGroupId)
    return g?.name ?? '分组'
  }
  return '全部笔记'
})

/**
 * 空态分五种：搜索无结果与「这个视图本来就没东西」是两回事，
 * 前者要给「清除搜索」的出口，后者才引导新建。
 */
const empty = computed(() => {
  if (ui.query.trim()) {
    return { title: `没有匹配「${ui.query.trim()}」的笔记`, hint: '换个词试试', action: '清除搜索' }
  }
  if (ui.view === 'star') {
    return { title: '没有星标笔记', hint: '在笔记顶栏点 ☆ 收藏常用的笔记', action: '' }
  }
  if (ui.view === 'group') {
    return { title: `「${viewTitle.value}」里还没有笔记`, hint: '', action: '新建笔记' }
  }
  return { title: '还没有笔记', hint: '记点什么吧', action: '新建笔记' }
})

function onEmptyAction() {
  if (empty.value.action === '清除搜索') ui.query = ''
  else notes.create()
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

      <span class="header-title">{{ viewTitle }}</span>
      <span v-if="!notes.stale" class="header-count">{{ notes.visible.length }}</span>

      <button class="header-create" title="新建笔记" aria-label="新建笔记" @click="notes.create()">
        <AppIcon name="plus" :size="15" />
        <span>新建</span>
      </button>
    </div>

    <NoteSearch @first="focusFirst" />
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
        :group-name="note.group_id ? groupNames.get(note.group_id) : undefined"
        @click="selectNote(note.id)"
        @pointerdown="onPointerDown"
        @pointerup="(e: PointerEvent) => onPointerUp(e, note.id)"
        @pointercancel="swipeStartX = null"
      >
        <template #actions>
          <!-- 触屏左滑展开删除；桌面端在悬停或键盘聚焦时显示。 -->
          <button class="delete" title="删除" aria-label="删除" @click.stop="confirmTrashId = note.id">
            <AppIcon name="trash" :size="16" class="delete-icon" />
            <span class="delete-label">删除</span>
          </button>
        </template>
      </NoteListItem>
    </ul>

    <ConfirmDialog
      :open="confirmTrashId !== null"
      title="删除这条笔记？"
      message="笔记会移入回收站，可随时恢复。"
      confirm-text="删除"
      @confirm="runTrash"
      @cancel="confirmTrashId = null"
    />
  </div>
</template>
