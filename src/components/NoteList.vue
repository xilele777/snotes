<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import EmptyState from './EmptyState.vue'
import NoteListItem from './NoteListItem.vue'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { useGroupsStore } from '../stores/groups'

const notes = useNotesStore()
const groups = useGroupsStore()
const ui = useUiStore()

// 左滑删除：pointer 事件记录起点，松手时按位移决定是否展开删除按钮。
const swipeStartX = ref<number | null>(null)
const swipedId = ref<string | null>(null)
const SWIPE_THRESHOLD = 40

function onPointerDown(e: PointerEvent) {
  swipeStartX.value = e.clientX
}
function onPointerUp(e: PointerEvent, noteId: string) {
  if (swipeStartX.value === null) return
  const delta = e.clientX - swipeStartX.value
  if (delta < -SWIPE_THRESHOLD) swipedId.value = noteId
  else if (delta > SWIPE_THRESHOLD) swipedId.value = null
  swipeStartX.value = null
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

onMounted(() => notes.load())
</script>

<template>
  <div class="list-view">
    <!-- 列表区 header：≤1020px 出抽屉按钮，右侧常驻新建（原站 listHeader 56px） -->
    <div class="list-header">
      <button class="drawer-btn" title="打开侧栏" aria-label="打开侧栏" @click="ui.drawerOpen = true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <span class="header-title">{{ viewTitle }}</span>

      <button class="header-create" title="新建笔记" aria-label="新建笔记" @click="notes.create()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>

    <EmptyState
      v-if="notes.visible.length === 0"
      :title="empty.title"
      :hint="empty.hint"
      :action="empty.action"
      @action="onEmptyAction"
    />

    <ul v-else class="note-list">
      <NoteListItem
        v-for="note in notes.visible"
        :key="note.id"
        :note="note"
        :active="note.id === notes.currentId"
        :swiped="swipedId === note.id"
        :query="ui.query"
        @click="notes.currentId = note.id"
        @pointerdown="onPointerDown"
        @pointerup="(e: PointerEvent) => onPointerUp(e, note.id)"
      >
        <template #actions>
          <!-- 左滑露出的删除按钮，宽 80px、--danger 背景（UI 规格 §4.2） -->
          <button class="delete" title="删除" @click.stop="notes.trash(note.id)">删除</button>
        </template>
      </NoteListItem>
    </ul>
  </div>
</template>
