<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../stores/ui'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import { useNotesStore } from '../stores/notes'
import { flattenToc } from '../../shared/knowledge-base'
import type { TocNode } from '../../shared/knowledge-base'
import { showKnowledgeBases } from '../navigation'
import KnowledgeBaseInfo from './KnowledgeBaseInfo.vue'
const notes = useNotesStore()
const ui = useUiStore()
const libraries = useKnowledgeBasesStore()
const book = computed(() => libraries.books.find(b => b.id === ui.activeKnowledgeBaseId))
const nodes = computed(() => libraries.tocs.find(t => t.knowledge_base_id === book.value?.id)?.nodes ?? [])
const recent = computed(() => {
  const ids = new Set(nodes.value.flatMap(n => n.note_id ? [n.note_id] : []))
  return libraries.notes.filter(n => n.invalid === 0 && ids.has(n.id)).sort((a, b) => b.update_time - a.update_time).slice(0, 6)
})
const outline = computed(() => flattenToc(nodes.value).filter(({ node }) => node.kind === 'folder').slice(0, 8))
function openNote(id: string) {
  ui.activeTocNodeId = nodes.value.find(n => n.note_id === id)?.id ?? null
  notes.open(id)
}
function openChapter(node: TocNode) {
  ui.activeTocNodeId = node.id
  ui.collapsedKnowledgeBaseNodes = ui.collapsedKnowledgeBaseNodes.filter(id => id !== node.id)
  document.querySelector<HTMLElement>(`[data-node-id="${node.id}"] .kb-node-link`)?.focus()
}
</script>

<template>
  <section class="editor-pane knowledge-base-home" aria-label="笔记本首页">
    <div v-if="book && !book.invalid" class="kb-home-content">
      <KnowledgeBaseInfo :book="book" />
      <section class="kb-home-section" aria-label="最近更新的笔记">
        <h2>最近更新</h2>
        <ul v-if="recent.length"><li v-for="note in recent" :key="note.id"><button @click="openNote(note.id)"><span>{{ note.title || '无标题' }}</span><time>{{ new Date(note.update_time).toLocaleDateString('zh-CN') }}</time></button></li></ul>
        <p v-else>还没有笔记，从左侧新建开始记录。</p>
      </section>
      <section v-if="outline.length" class="kb-home-section" aria-label="目录速览"><h2>目录速览</h2><ul><li v-for="{ node, depth } in outline" :key="node.id"><button :style="{ paddingLeft: `${depth * 14 + 8}px` }" @click="openChapter(node)">{{ node.title || '未命名章节' }}</button></li></ul></section>
    </div>
    <div v-else class="kb-home-content"><h1>笔记本不可用</h1><button class="dialog-btn cancel" @click="showKnowledgeBases()">返回笔记本列表</button></div>
  </section>
</template>

<style scoped>
.knowledge-base-home { overflow: auto; }
.kb-home-content { width: 100%; max-width: 784px; margin: 0 auto; padding: clamp(36px, 6vw, 80px) clamp(24px, 3.5vw, 48px); overflow-wrap: anywhere; }
.kb-home-section { margin-top: 28px; }
.kb-home-section h2 { font-size: 15px; margin: 0 0 10px; }
.kb-home-section ul { list-style: none; padding: 0; margin: 0; }
.kb-home-section button { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; padding: 12px 8px; border: 0; border-bottom: 1px solid var(--border-light); background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; text-align: left; }
.kb-home-section button:hover { background: var(--bg-hover); color: var(--accent); }
.kb-home-section button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-home-section time, .kb-home-section p { flex: none; color: var(--text-tertiary); font-size: 12px; }
</style>
