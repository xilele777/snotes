<script setup lang="ts">
import { ref, watch } from 'vue'
import { hasToken } from './api/token'
import NoteList from './components/NoteList.vue'
import TokenGate from './components/TokenGate.vue'
import { useNotesStore } from './stores/notes'

const notes = useNotesStore()

// 移动端 <720px 列表↔编辑器互斥（UI 规格 §2.3）
const mobilePane = ref<'list' | 'editor'>('list')

// 选中笔记即切到编辑器；当前笔记被清空（如删除）则回到列表
watch(
  () => notes.currentId,
  (id) => {
    if (id) mobilePane.value = 'editor'
  },
)
function backToList() {
  mobilePane.value = 'list'
}
</script>

<template>
  <TokenGate v-if="!hasToken" />

  <div v-else class="layout" :data-mobile-pane="mobilePane">
    <section class="list-pane">
      <NoteList />
    </section>

    <main class="editor-pane">
      <div class="editor-top-bar">
        <!-- 移动端返回按钮，仅 <720px 显示 -->
        <button class="back-btn" title="返回列表" @click="backToList">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span class="top-title">{{ notes.current?.title || '选择或新建一条笔记' }}</span>
      </div>
      <div class="editor-body">
        <p v-if="!notes.current" class="placeholder">选择或新建一条笔记</p>
        <pre v-else>{{ notes.current.body }}</pre>
      </div>
    </main>

    <!-- 浮动新建按钮（UI 规格 §4.2）：fixed、圆形 54px、--create-yellow -->
    <button class="create-btn" title="新建笔记" @click="notes.create()">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  </div>
</template>
