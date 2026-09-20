<script setup lang="ts">
import { computed } from 'vue'
import { extractSearchExcerpt } from '../../shared/derive'
import type { LocalNote } from '../../shared/types'
import { highlight, matchesAll, splitTerms } from './SearchBar'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    note: LocalNote
    active?: boolean
    swiped?: boolean
    /** 搜索词，用于标题与摘要的命中高亮。 */
    query?: string
    groupName?: string
  }>(),
  { active: false, swiped: false, query: '' }
)

/** 标题与摘要都没把关键词凑齐时，用正文里命中附近的片段替换普通摘要。 */
const displaySummary = computed(() => {
  const terms = splitTerms(props.query)
  if (terms.length === 0) return props.note.summary
  if (matchesAll(`${props.note.title}
${props.note.summary}`, terms)) return props.note.summary
  return extractSearchExcerpt(props.note.body, props.query) ?? props.note.summary
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
  <!-- 标题、摘要和元信息各占一行，空摘要也保留行高。 -->
  <li
    class="note-item"
    :data-note-id="note.id"
    :class="{ 'is-top': note.top === 1, 'is-active': active, swiped }"
    :style="note.skin_color ? { '--skin': note.skin_color } : undefined"
  >
    <button type="button" class="note-select" :aria-current="active ? 'true' : undefined" :aria-label="`打开笔记：${note.title || '无标题'}`">
      <img v-if="note.thumbnail" class="thumb" :src="`/api/images/${note.thumbnail}`" alt="" loading="lazy" decoding="async" width="44" height="44" />

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

      <div class="note-meta">
        <time class="note-date" :datetime="new Date(note.update_time).toISOString()" :title="new Date(note.update_time).toLocaleString('zh-CN')">{{ fmtDate(note.update_time) }}</time>
        <span v-if="note.top === 1" class="note-pin" role="img" aria-label="置顶"><AppIcon name="pin" :size="12" /></span>
        <span v-if="note.star === 1" class="note-star" role="img" aria-label="星标"><AppIcon name="star" :size="12" /></span>
        <span v-if="groupName" class="note-group-label">{{ groupName }}</span>
        <slot name="meta" />
      </div>
    </button>

    <!-- 行内动作：列表是左滑删除，回收站是恢复/彻底删除 -->
    <slot name="actions" />
  </li>
</template>
