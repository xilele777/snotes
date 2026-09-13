<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { isMobile, openDrawer, pushNav } from '../navigation'
import EmptyState from './EmptyState.vue'
import ListSkeleton from './ListSkeleton.vue'
import NoteListItem from './NoteListItem.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import NoteSearch from './NoteSearch.vue'

const notes = useNotesStore()
const ui = useUiStore()

function selectNote(id: string) {
  if (isMobile() && ui.mobilePane === 'list') pushNav()
  notes.currentId = id
  if (isMobile()) ui.mobilePane = 'editor'
}

onMounted(() => {
  if (notes.stale) void notes.load()
})

/** 确认弹窗：null 关闭；{ kind: 'single' } 是某条笔记的彻底删除，'clean' 是清空回收站 */
const confirm = ref<{ kind: 'single'; id: string } | { kind: 'clean' } | null>(null)

async function runConfirm() {
  if (confirm.value === null) return
  if (confirm.value.kind === 'single') await notes.purge(confirm.value.id)
  else await notes.purgeAll()
  confirm.value = null
}
</script>

<template>
  <div class="list-view">
    <div class="list-header">
      <button class="drawer-btn" title="打开侧栏" aria-label="打开侧栏" @click="openDrawer()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <span class="header-title">回收站</span>
      <span v-if="!notes.stale" class="header-count">{{ notes.visible.length }}</span>

      <button v-if="notes.notes.length > 0" class="clean-all" @click="confirm = { kind: 'clean' }">
        清空
      </button>
    </div>

    <NoteSearch @first="notes.visible[0] && selectNote(notes.visible[0].id)" />
    <div class="list-caption"><span>删除的笔记，可以在这里找回</span></div>

    <ListSkeleton v-if="notes.stale" />
    <EmptyState v-else-if="notes.notes.length === 0" title="回收站是空的" hint="删掉的笔记会先放到这里" />
    <EmptyState v-else-if="notes.visible.length === 0" title="没有匹配的笔记" hint="换个关键词试试" action="清除搜索" @action="ui.query = ''" />

    <ul v-else class="note-list">
      <NoteListItem
        v-for="note in notes.visible"
        :key="note.id"
        :note="note"
        class="trash-item"
        :active="note.id === notes.currentId"
        :query="ui.query"
        @click="selectNote(note.id)"
      >
        <template #actions>
          <div class="trash-acts" @click.stop>
            <button class="recover" @click="notes.recover(note.id)">恢复</button>
            <button class="purge" @click="confirm = { kind: 'single', id: note.id }">彻底删除</button>
          </div>
        </template>
      </NoteListItem>
    </ul>

    <ConfirmDialog
      :open="confirm !== null"
      :title="confirm?.kind === 'single' ? '彻底删除这条笔记？' : '清空回收站？'"
      :message="confirm?.kind === 'single' ? '彻底删除后无法恢复。' : '回收站里的所有笔记将永久删除，无法恢复。'"
      :confirm-text="confirm?.kind === 'single' ? '彻底删除' : '清空回收站'"
      @confirm="runConfirm"
      @cancel="confirm = null"
    />
  </div>
</template>
