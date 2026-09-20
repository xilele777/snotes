<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isMobile, openDrawer, pushNav } from '../navigation'
import EmptyState from './EmptyState.vue'
import ListSkeleton from './ListSkeleton.vue'
import NoteListItem from './NoteListItem.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import NoteSearch from './NoteSearch.vue'
import AppIcon from './AppIcon.vue'
import { useWorkspaceScroll } from './useWorkspaceScroll'
import { getMeta } from '../db/repo'
import { TRASH_RETENTION_KEY } from '../sync/pull'

const notes = useNotesStore()
const ui = useUiStore()
const list = ref<HTMLElement | null>(null)
useWorkspaceScroll(list, 'list')

function selectNote(id: string) {
  if (isMobile() && ui.mobilePane === 'list') pushNav()
  notes.currentId = id
  if (isMobile()) ui.mobilePane = 'editor'
}

onMounted(async () => {
  if (notes.stale) void notes.load()
  // 还没同步过时先用上次缓存的配置；一直没有就当作未知，不显示提示
  if (ui.trashRetentionDays === undefined) {
    const cached = await getMeta<number | null>(TRASH_RETENTION_KEY)
    if (cached !== undefined && ui.trashRetentionDays === undefined) ui.trashRetentionDays = cached
  }
})

/** 回收站页顶部的保留期提示：服务端开启自动清理时说明几天后删除，否则说明会一直保留 */
const retentionHint = computed(() => {
  const days = ui.trashRetentionDays
  if (days === undefined) return null
  if (days === null) return '回收站里的笔记会一直保留，直到手动彻底删除或清空。'
  return `笔记移入回收站 ${days} 天后会自动彻底删除，届时无法恢复。`
})

/** 某条笔记还剩几天被自动删除；进回收站的时间就是它的 update_time */
function daysLeft(updateTime: number): number | null {
  const days = ui.trashRetentionDays
  if (!days) return null
  const left = Math.ceil((updateTime + days * 86_400_000 - Date.now()) / 86_400_000)
  return Math.max(0, left)
}

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
        <AppIcon name="menu" />
      </button>

      <span class="header-title">回收站</span>
      <span v-if="!notes.stale" class="header-count">{{ notes.visible.length }}</span>

      <button v-if="notes.notes.length > 0" class="clean-all" @click="confirm = { kind: 'clean' }">
        清空
      </button>
    </div>

    <p v-if="retentionHint && notes.notes.length > 0" class="trash-hint" role="note">{{ retentionHint }}</p>

    <NoteSearch v-if="notes.notes.length > 0 || ui.query.trim()" @first="notes.visible[0] && selectNote(notes.visible[0].id)" />

    <ListSkeleton v-if="notes.stale" />
    <EmptyState v-else-if="notes.notes.length === 0" icon="trash" title="暂无已删除笔记" />
    <EmptyState v-else-if="notes.visible.length === 0" icon="search" title="没有匹配的笔记" action="清除搜索" @action="ui.query = ''" />

    <ul v-else ref="list" class="note-list" aria-label="已删除笔记">
      <NoteListItem
        v-for="note in notes.visible"
        :key="note.id"
        :note="note"
        class="trash-item"
        :active="note.id === notes.currentId"
        :query="ui.query"
        @click="selectNote(note.id)"
      >
        <template #meta>
          <span v-if="daysLeft(note.update_time) !== null" class="trash-days-left">{{ daysLeft(note.update_time) }} 天后删除</span>
        </template>
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
