<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { useGroupsStore } from '../stores/groups'
import { highlight } from './SearchBar'

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

// 列表 header 视图标题：全部笔记 / 星标 / 分组名 / 回收站
const viewTitle = () => {
  if (ui.view === 'star') return '星标'
  if (ui.view === 'group') {
    const g = groups.groups.find((x) => x.group_id === ui.activeGroupId)
    return g?.name ?? '分组'
  }
  return '全部笔记'
}

// 日期格式化：今天显示 HH:mm，否则 MM-DD，跨年带年份
function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

onMounted(() => notes.load())
</script>

<template>
  <div class="list-view">
    <!-- 列表区 header（原站 listHeader）：logo 名 + 视图标题 -->
    <div class="list-header">
      <span class="header-name">snotes</span>
      <span class="header-title">{{ viewTitle() }}</span>
    </div>

    <ul class="note-list">
      <li v-if="notes.visible.length === 0" class="empty">还没有笔记</li>

      <li
        v-for="note in notes.visible"
        :key="note.id"
        class="note-item"
        :data-note-id="note.id"
        :class="{
          'is-top': note.top === 1,
          'is-active': note.id === notes.currentId,
          'swiped': swipedId === note.id,
        }"
        :style="note.skin_color ? { '--skin': note.skin_color } : undefined"
        @click="notes.currentId = note.id"
        @pointerdown="onPointerDown"
        @pointerup="(e) => onPointerUp(e, note.id)"
      >
        <!-- 缩略图 float:right（原站 note_list_item_thumb） -->
        <img v-if="note.thumbnail" class="thumb" :src="`/api/images/${note.thumbnail}`" alt="" />

        <div class="note-text">
          <div class="note-title">
            <template v-if="note.title">
              <span
                v-for="(seg, i) in highlight(note.title, ui.query)"
                :key="i"
                :class="{ hit: seg.hit }"
              >{{ seg.text }}</span>
            </template>
            <template v-else>无标题</template>
          </div>
          <div class="note-summary">{{ note.summary }}</div>
        </div>

        <!-- 底部日期行：日期 + 常驻标记图标（置顶/星标，原站 note_list_item_date） -->
        <div class="note-meta">
          <span class="note-date">{{ fmtDate(note.update_time) }}</span>
          <!-- 置顶图钉：top=1 才显示 -->
          <svg v-if="note.top === 1" class="note-pin" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="置顶">
            <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
          </svg>
          <!-- 星标：star=1 才显示 -->
          <svg v-if="note.star === 1" class="note-star" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="星标">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
          </svg>
        </div>

        <!-- 分隔线缩进（原站 note_list_bottom_line） -->
        <div class="note-divider"></div>

        <!-- 左滑露出的删除按钮，宽 80px、--danger 背景（UI 规格 §4.2） -->
        <button class="delete" title="删除" @click.stop="notes.trash(note.id)">删除</button>
      </li>
    </ul>
  </div>
</template>
