<script setup lang="ts">
import { computed } from 'vue'
import { extractSearchExcerpt } from '../../shared/derive'
import type { LocalNote } from '../../shared/types'
import { highlight } from './SearchBar'

const props = withDefaults(
  defineProps<{
    note: LocalNote
    active?: boolean
    swiped?: boolean
    /** 搜索词，用于标题命中高亮；回收站不传 */
    query?: string
  }>(),
  { active: false, swiped: false, query: '' }
)

/** 标题未命中而正文命中时，用命中附近的正文替换普通摘要。 */
const displaySummary = computed(() => {
  const query = props.query.trim()
  if (!query) return props.note.summary

  const normalized = query.toLowerCase()
  if (props.note.title.toLowerCase().includes(normalized) || props.note.summary.toLowerCase().includes(normalized)) {
    return props.note.summary
  }
  return extractSearchExcerpt(props.note.body, query) ?? props.note.summary
})

/** 日期格式化：今天显示 HH:mm，否则 MM-DD，跨年带年份 */
function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
</script>

<template>
  <!--
    行高必须逐子元素钉死（对照原站 note_list_item_minipro 的 .23/.19/.17rem）。
    只给容器定高是不够的：摘要为空时 .note-summary 是个空块级元素，高度塌成 0，
    下面的日期行整体上移，同一列表里有摘要和没摘要的两行看起来就不等高。
  -->
  <li
    class="note-item"
    :data-note-id="note.id"
    :class="{ 'is-top': note.top === 1, 'is-active': active, swiped }"
    :style="note.skin_color ? { '--skin': note.skin_color } : undefined"
  >
    <!-- 缩略图 float:right（原站 note_list_item_thumb） -->
    <img v-if="note.thumbnail" class="thumb" :src="`/api/images/${note.thumbnail}`" alt="" />

    <div class="note-text">
      <div class="note-title">
        <template v-if="note.title">
          <span v-for="(seg, i) in highlight(note.title, query)" :key="i" :class="{ hit: seg.hit }">{{
            seg.text
          }}</span>
        </template>
        <template v-else>无标题</template>
      </div>
      <div class="note-summary"><span v-for="(seg, i) in highlight(displaySummary, query)" :key="i" :class="{ hit: seg.hit }">{{ seg.text }}</span></div>
    </div>

    <!-- 底部日期行：日期 + 常驻标记图标（置顶/星标，原站 note_list_item_date） -->
    <div class="note-meta">
      <span class="note-date">{{ fmtDate(note.update_time) }}</span>
      <svg
        v-if="note.top === 1"
        class="note-pin"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-label="置顶"
      >
        <path
          d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"
        />
      </svg>
      <svg
        v-if="note.star === 1"
        class="note-star"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-label="星标"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
      </svg>
    </div>

    <div class="note-divider"></div>

    <!-- 行内动作：列表是左滑删除，回收站是恢复/彻底删除 -->
    <slot name="actions" />
  </li>
</template>
