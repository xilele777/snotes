<script setup lang="ts">
import { computed } from 'vue'
import type { KnowledgeBase } from '../../shared/knowledge-base'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import AppIcon from './AppIcon.vue'

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
    <div class="kb-info-cover">
      <header v-if="!compact" class="kb-info-heading">
        <div class="kb-info-identity">
          <span class="kb-info-icon" aria-hidden="true"><AppIcon v-if="!book.icon || book.icon === '📚'" name="book" :size="28" /><span v-else>{{ book.icon }}</span></span>
          <span class="kb-info-eyebrow">笔记本概览</span>
        </div>
        <h1>{{ book.name }}</h1>
        <p v-if="book.description" class="kb-info-description">{{ book.description }}</p>
      </header>
      <p v-else-if="book.description" class="kb-info-description">{{ book.description }}</p>
      <dl class="kb-info-stats">
        <div class="kb-info-stat notes"><dt><AppIcon name="note" :size="16" />笔记</dt><dd>{{ noteCount }} <span>篇</span></dd></div>
        <div class="kb-info-stat chapters"><dt><AppIcon name="folder" :size="16" />章节</dt><dd>{{ chapterCount }} <span>个</span></dd></div>
        <div class="kb-info-date"><dt><AppIcon name="clock" :size="16" />创建时间</dt><dd><time :datetime="new Date(book.create_time).toISOString()">{{ date(book.create_time) }}</time></dd></div>
        <div class="kb-info-date"><dt><AppIcon name="refresh" :size="16" />最近更新</dt><dd><time :datetime="new Date(updated).toISOString()">{{ date(updated) }}</time></dd></div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.kb-info { --cover-padding: clamp(24px, 3.2vw, 40px); container-type: inline-size; }
.kb-info-cover { overflow: hidden; border: 1px solid var(--border-light); border-radius: 16px; background: color-mix(in srgb, var(--accent) 2%, var(--bg-list)); }
.kb-info-heading { padding: var(--cover-padding); padding-bottom: 32px; }
.kb-info-identity { display: flex; align-items: center; gap: 18px; margin-bottom: 28px; }
.kb-info-icon { position: relative; display: grid; place-items: center; flex: none; width: 56px; height: 68px; padding-left: 4px; border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-light)); border-radius: 5px 10px 10px 5px; background: var(--accent-soft); color: var(--accent); font-size: 28px; line-height: 1; box-shadow: 2px 3px 0 var(--bg-surface), 3px 4px 0 var(--border-light); }
.kb-info-icon::before { content: ''; position: absolute; inset: 0 auto 0 5px; width: 1px; background: color-mix(in srgb, var(--accent) 18%, transparent); }
.kb-info-eyebrow { color: var(--text-tertiary); font-size: 12px; letter-spacing: .12em; }
h1 { margin: 0; font-size: clamp(26px, 2.6vw, 34px); font-weight: 650; line-height: 1.4; letter-spacing: -.035em; overflow-wrap: anywhere; text-wrap: pretty; }
.kb-info-description { margin: 16px 0 0; font-size: 14px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); }
.kb-info-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; border-top: 1px solid var(--border-light); background: var(--bg-surface); }
.kb-info-stats > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 22px var(--cover-padding); }
.kb-info-stats > div:nth-child(even) { border-left: 1px solid var(--border-light); }
.kb-info-stats > div:nth-child(n + 3) { border-top: 1px solid var(--border-light); }
dt { display: flex; align-items: center; flex: none; gap: 8px; color: var(--text-secondary); font-size: 14px; line-height: 1.5; }
dt .app-icon { color: var(--text-tertiary); }
dd { display: flex; align-items: center; justify-content: flex-end; min-width: 0; min-height: 41px; margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.kb-info-stat dd { align-items: baseline; gap: 6px; color: var(--text-primary); font-size: 34px; line-height: 1.2; font-weight: 700; letter-spacing: -.03em; overflow-wrap: anywhere; }
.kb-info-stat dd span { color: var(--text-secondary); font-size: 14px; font-weight: 500; letter-spacing: 0; white-space: nowrap; }
time { display: block; color: var(--text-primary); font-size: 17px; line-height: 1.6; font-weight: 650; }
.compact { padding: 8px 0 18px; }
.compact .kb-info-cover { border: 0; border-radius: 0; background: none; }
.compact .kb-info-description { margin: 0 0 16px; font-size: 13px; }
.compact .kb-info-stats { border: 1px solid var(--border-light); border-radius: 10px; }
.compact .kb-info-stats > div { padding: 16px 12px; gap: 8px; }
.compact dd { min-height: 34px; }
.compact .kb-info-stat dd { font-size: 28px; }
.compact time { font-size: 15px; }
@container (max-width: 620px) {
  .kb-info-stats { grid-template-columns: minmax(0, 1fr); }
  .kb-info-stats > div:nth-child(even) { border-left: 0; }
  .kb-info-stats > div + div { border-top: 1px solid var(--border-light); }
}
</style>
