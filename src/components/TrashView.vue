<script setup lang="ts">
import EmptyState from './EmptyState.vue'
import NoteListItem from './NoteListItem.vue'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'

const notes = useNotesStore()
const ui = useUiStore()

async function cleanAll() {
  if (!confirm('清空回收站将永久删除这些笔记，无法恢复。确定继续？')) return
  await notes.purgeAll()
}
</script>

<template>
  <div class="list-view">
    <div class="list-header">
      <button class="drawer-btn" title="打开侧栏" aria-label="打开侧栏" @click="ui.drawerOpen = true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <span class="header-title">回收站</span>

      <button v-if="notes.notes.length > 0" class="clean-all" @click="cleanAll">清空</button>
    </div>

    <EmptyState v-if="notes.notes.length === 0" title="回收站是空的" hint="删掉的笔记会先放到这里" />

    <ul v-else class="note-list">
      <NoteListItem
        v-for="note in notes.notes"
        :key="note.id"
        :note="note"
        class="trash-item"
        :active="note.id === notes.currentId"
        @click="notes.currentId = note.id"
      >
        <template #actions>
          <div class="trash-acts" @click.stop>
            <button class="recover" @click="notes.recover(note.id)">恢复</button>
            <button class="purge" @click="notes.purge(note.id)">彻底删除</button>
          </div>
        </template>
      </NoteListItem>
    </ul>
  </div>
</template>
