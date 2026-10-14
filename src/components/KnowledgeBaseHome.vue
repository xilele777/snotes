<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../stores/ui'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import { useNotesStore } from '../stores/notes'
import AppIcon from './AppIcon.vue'
const ui = useUiStore()
const libraries = useKnowledgeBasesStore()
const notes = useNotesStore()
const book = computed(() => libraries.books.find(b => b.id === ui.activeKnowledgeBaseId))
const count = computed(() => {
  const ids = new Set(libraries.tocs.find(t => t.knowledge_base_id === book.value?.id)?.nodes.flatMap(n => n.note_id ? [n.note_id] : []) ?? [])
  return libraries.notes.filter(n => n.invalid === 0 && ids.has(n.id)).length
})
</script>
<template>
  <section class="editor-pane knowledge-base-home" aria-label="知识库首页">
    <div v-if="book && !book.invalid" class="kb-home-content">
      <span class="kb-home-icon" aria-hidden="true">{{ book.icon || '📚' }}</span><p class="kb-eyebrow">个人知识库</p><h1>{{ book.name }}</h1>
      <p class="kb-description">{{ book.description || '把相关笔记整理成章节，让知识有条理地生长。' }}</p>
      <p class="kb-home-meta">{{ count }} 篇笔记 · 更新于 {{ new Date(book.update_time).toLocaleDateString() }}</p>
      <button class="dialog-btn ok" @click="notes.create()"><AppIcon name="plus" :size="16" /> 新建笔记</button>
      <p class="kb-home-tip">从左侧目录打开笔记，也可以加入已有笔记。正文与原笔记保持同步。</p>
    </div>
    <div v-else class="kb-home-content"><h1>知识库已移除</h1><p>可以从知识库列表的“已移除”入口恢复，笔记正文仍然保留。</p></div>
  </section>
</template>
<style scoped>
.knowledge-base-home { overflow: auto; }
.kb-home-content { width: 100%; max-width: 800px; margin: 0 auto; padding: clamp(32px, 7vw, 90px) clamp(24px, 5vw, 64px); overflow-wrap: anywhere; }
.kb-home-icon { font-size: 54px; }
.kb-eyebrow { color: var(--text-tertiary); margin: 28px 0 8px; font-size: 12px; }
h1 { margin: 0 0 18px; font-size: 30px; font-weight: 650; line-height: 1.4; }
.kb-description { white-space: pre-wrap; color: var(--text-secondary); }
.kb-home-meta { font-size: 12px; color: var(--text-tertiary); margin: 26px 0; }
.kb-home-tip { margin-top: 24px; font-size: 12px; color: var(--text-tertiary); }
</style>
