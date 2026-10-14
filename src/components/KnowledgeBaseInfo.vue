<script setup lang="ts">
import { computed } from 'vue'
import type { KnowledgeBase } from '../../shared/knowledge-base'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'

const props = defineProps<{ book: KnowledgeBase; compact?: boolean }>()
const libraries = useKnowledgeBasesStore()
const toc = computed(() => libraries.tocs.find(t => t.knowledge_base_id === props.book.id))
const nodes = computed(() => toc.value?.nodes ?? [])
const noteIds = computed(() => new Set(nodes.value.flatMap(node => node.note_id ? [node.note_id] : [])))
const activeNotes = computed(() => libraries.notes.filter(note => noteIds.value.has(note.id) && note.invalid === 0))
const noteCount = computed(() => activeNotes.value.length)
const chapterCount = computed(() => nodes.value.filter(node => node.kind === 'folder').length)
const updated = computed(() => Math.max(props.book.update_time, toc.value?.update_time ?? 0, ...activeNotes.value.map(note => note.update_time)))
const date = (time: number) => new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
</script>

<template>
  <div class="kb-info" :class="{ compact }">
    <div v-if="!compact" class="kb-info-heading"><span class="kb-info-icon" aria-hidden="true">{{ book.icon || '📚' }}</span><h1>{{ book.name }}</h1></div>
    <p v-if="book.description" class="kb-info-description">{{ book.description }}</p>
    <dl class="kb-info-facts">
      <div><dt>笔记</dt><dd>{{ noteCount }} <span>篇</span></dd></div>
      <div><dt>章节</dt><dd>{{ chapterCount }} <span>个</span></dd></div>
      <div><dt>创建时间</dt><dd><time :datetime="new Date(book.create_time).toISOString()">{{ date(book.create_time) }}</time></dd></div>
      <div><dt>最近更新</dt><dd><time :datetime="new Date(updated).toISOString()">{{ date(updated) }}</time></dd></div>
    </dl>
  </div>
</template>

<style scoped>
.kb-info-heading { display: flex; align-items: center; gap: 16px; }
.kb-info-icon { flex: none; font-size: 32px; line-height: 1.4; }
h1 { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.kb-info-description { margin: 24px 0 0; font-size: 14px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); }
.kb-info-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 32px; margin: 32px 0 0; padding: 28px 0; border-top: 1px solid var(--border-light); border-bottom: 1px solid var(--border-light); }
dt { margin-bottom: 6px; color: var(--text-tertiary); font-size: 12px; }
dd { margin: 0; font-size: 16px; font-variant-numeric: tabular-nums; }
dd span, time { font-size: 13px; }
.compact .kb-info-description { margin-top: 12px; font-size: 13px; }
.compact .kb-info-facts { margin: 14px 0 0; padding: 14px 0; gap: 16px; border-bottom: 0; }
</style>
