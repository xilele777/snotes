<script setup lang="ts">
import { useNotesStore } from '../stores/notes'
import { purgeNote } from '../db/repo'

const notes = useNotesStore()

async function cleanAll() {
  if (!confirm('清空回收站将永久删除这些笔记，无法恢复。确定继续？')) return
  await notes.purgeAll()
}

async function purge(id: string) {
  await purgeNote(id)
  await notes.load()
}
</script>

<template>
  <div class="trash-view">
    <div class="trash-header">
      <span class="trash-title">回收站</span>
      <button v-if="notes.notes.length > 0" class="clean-all" @click="cleanAll">清空</button>
    </div>

    <ul class="note-list">
      <li v-for="note in notes.notes" :key="note.id" class="note-item trash-item">
        <div class="note-text">
          <div class="note-title">{{ note.title || '无标题' }}</div>
          <div class="note-summary">{{ note.summary }}</div>
        </div>
        <div class="trash-acts" @click.stop>
          <button class="recover" @click="notes.recover(note.id)">恢复</button>
          <button class="purge" @click="purge(note.id)">彻底删除</button>
        </div>
      </li>
    </ul>
  </div>
</template>
