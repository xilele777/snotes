<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ListView } from '../db/repo'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'

const groups = useGroupsStore()
const notes = useNotesStore()
const ui = useUiStore()

const newName = ref('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')

onMounted(() => groups.load())

async function switchView(view: ListView, groupId: string | null = null) {
  ui.view = view
  ui.activeGroupId = groupId
  await notes.load()
}

async function addGroup() {
  const name = newName.value.trim()
  if (!name) return

  await groups.create(name)
  newName.value = ''
}

function startRename(groupId: string, currentName: string) {
  renamingId.value = groupId
  renameValue.value = currentName
}

async function commitRename(groupId: string) {
  const name = renameValue.value.trim()
  if (name) await groups.rename(groupId, name)
  renamingId.value = null
}
</script>

<template>
  <nav class="group-sidebar">
    <div class="sidebar-search">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input v-model="ui.query" type="search" placeholder="搜索笔记" />
    </div>

    <ul class="views">
      <li data-view="all" :class="{ active: ui.view === 'all' }" @click="switchView('all')">
        全部笔记
      </li>
      <li data-view="star" :class="{ active: ui.view === 'star' }" @click="switchView('star')">
        星标
      </li>
      <li data-view="trash" :class="{ active: ui.view === 'trash' }" @click="switchView('trash')">
        回收站
      </li>
    </ul>

    <div class="group-header">分组</div>

    <ul class="groups">
      <li
        v-for="group in groups.groups"
        :key="group.group_id"
        :data-group-id="group.group_id"
        :class="{ active: ui.activeGroupId === group.group_id }"
        @click="switchView('group', group.group_id)"
      >
        <span class="dot" :style="group.color ? { backgroundColor: group.color } : undefined"></span>

        <template v-if="renamingId === group.group_id">
          <input
            v-model="renameValue"
            class="rename-input"
            @click.stop
            @keyup.enter="commitRename(group.group_id)"
            @blur="commitRename(group.group_id)"
          />
        </template>
        <template v-else>
          <span class="group-name">{{ group.name }}</span>
          <button class="rename-btn" title="重命名" @click.stop="startRename(group.group_id, group.name)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>
        </template>
      </li>
    </ul>

    <div class="new-group">
      <input v-model="newName" placeholder="新建分组" @keyup.enter="addGroup" />
    </div>

    <div class="user-area">
      <!-- 同步状态指示，Task 20 接线后由 ui.syncing/failedCount 驱动 -->
      <span class="sync-idle" :class="{ 'has-failed': ui.failedCount > 0 }" :title="ui.failedCount > 0 ? `${ui.failedCount} 条改动未推送` : ''">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17.5 19a4.5 4.5 0 100-9 6 6 0 00-11.7 1.5A4 4 0 006 19h11.5z" />
        </svg>
        <span v-if="ui.failedCount > 0" class="failed-badge">{{ ui.failedCount }}</span>
      </span>
    </div>
  </nav>
</template>
