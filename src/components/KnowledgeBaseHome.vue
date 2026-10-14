<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../stores/ui'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import { openManagedView } from '../navigation'
import KnowledgeBaseInfo from './KnowledgeBaseInfo.vue'
const ui = useUiStore()
const libraries = useKnowledgeBasesStore()
const book = computed(() => libraries.books.find(b => b.id === ui.activeKnowledgeBaseId))
</script>

<template>
  <section class="editor-pane knowledge-base-home" aria-label="知识库首页">
    <div v-if="book && !book.invalid" class="kb-home-content">
      <KnowledgeBaseInfo :book="book" />
    </div>
    <div v-else class="kb-home-content"><h1>知识库已移除</h1><button class="dialog-btn cancel" @click="openManagedView('removed-knowledge-bases')">查看已移除的知识库</button></div>
  </section>
</template>

<style scoped>
.knowledge-base-home { overflow: auto; }
.kb-home-content { width: 100%; max-width: 760px; margin: 0 auto; padding: clamp(40px, 7vw, 88px) clamp(24px, 4vw, 56px); overflow-wrap: anywhere; }
</style>
