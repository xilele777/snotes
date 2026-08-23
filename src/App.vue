<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { hasToken } from './api/token'
import GroupSidebar from './components/GroupSidebar.vue'
import MilkdownEditor from './editor/MilkdownEditor.vue'
import NoteList from './components/NoteList.vue'
import TokenGate from './components/TokenGate.vue'
import TrashView from './components/TrashView.vue'
import { resolveShortcut } from './components/shortcut'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'

const notes = useNotesStore()
const ui = useUiStore()

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

// 全局快捷键（UI 规格 §6.2）
function onKeydown(e: KeyboardEvent) {
  const action = resolveShortcut(e, { hasQuery: ui.query.trim().length > 0 })
  if (!action) return

  if (action.type === 'create') {
    e.preventDefault()
    notes.create()
  } else if (action.type === 'focusSearch') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('.sidebar-search input')?.focus()
  } else if (action.type === 'clearQuery') {
    e.preventDefault()
    ui.query = ''
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <TokenGate v-if="!hasToken" />

  <div v-else class="layout" :data-mobile-pane="mobilePane">
    <aside class="sidebar-pane">
      <GroupSidebar />
    </aside>

    <section class="list-pane">
      <TrashView v-if="ui.view === 'trash'" />
      <NoteList v-else />
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
        <MilkdownEditor
          v-else
          :note-id="notes.current.id"
          :model-value="notes.current.body"
          @update:model-value="(md: string) => notes.saveBody(notes.current!.id, md)"
          @flush="(id: string, md: string) => notes.saveBody(id, md)"
        />
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
