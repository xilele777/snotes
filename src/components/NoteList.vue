<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useNotesStore } from '../stores/notes'

const notes = useNotesStore()

/**
 * 6 色皮肤板（UI 规格 §3.5）。null 排第一位，作为「清除颜色 / default」。
 * 顺序与值逐一对照 UI 规格，禁止随意改动。
 */
const SKIN_COLORS = [null, '#fed634', '#ffac00', '#e97663', '#5e7a88', '#3692f5'] as const

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

onMounted(() => notes.load())
</script>

<template>
  <ul class="note-list">
    <li v-if="notes.visible.length === 0" class="empty">还没有笔记</li>

    <li
      v-for="note in notes.visible"
      :key="note.id"
      class="note-item"
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
      <div class="note-text">
        <div class="note-title">
          <!-- 星标图标：内联 SVG，fill=currentColor，颜色由 .star 的 color 控制 -->
          <svg v-if="note.star === 1" class="star" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="星标">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
          </svg>
          <span>{{ note.title || '无标题' }}</span>
        </div>
        <div class="note-summary">{{ note.summary }}</div>
      </div>

      <img v-if="note.thumbnail" class="thumb" :src="`/api/images/${note.thumbnail}`" alt="" />

      <!-- 每个按钮都要 .stop：否则打标记会连带把这条笔记选中并跳转 -->
      <div class="note-acts" @click.stop>
        <button
          data-act="top"
          :aria-pressed="note.top === 1"
          :title="note.top === 1 ? '取消置顶' : '置顶'"
          @click="notes.setProps(note.id, { top: note.top === 1 ? 0 : 1 })"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" :class="note.top === 1 ? 'icon-pin-on' : 'icon-pin-off'">
            <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
          </svg>
        </button>

        <button
          data-act="star"
          :aria-pressed="note.star === 1"
          :title="note.star === 1 ? '取消星标' : '星标'"
          @click="notes.setProps(note.id, { star: note.star === 1 ? 0 : 1 })"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path v-if="note.star === 1" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
            <path v-else d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03z" fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
        </button>

        <span class="colors">
          <button
            v-for="color in SKIN_COLORS"
            :key="color ?? 'none'"
            :data-color="color ?? ''"
            class="swatch"
            :class="{ 'is-none': color === null }"
            :style="color ? { backgroundColor: color } : undefined"
            :title="color ? '标记颜色' : '清除颜色'"
            @click="notes.setProps(note.id, { skin_color: color })"
          />
        </span>
      </div>

      <!-- 左滑露出的删除按钮，宽 80px、--danger 背景（UI 规格 §4.2） -->
      <button class="delete" title="删除" @click.stop="notes.trash(note.id)">删除</button>
    </li>
  </ul>
</template>
