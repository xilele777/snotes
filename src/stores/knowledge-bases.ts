import { liveQuery } from 'dexie'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { KnowledgeBase, KnowledgeBaseToc } from '../../shared/knowledge-base'
import type { LocalNote } from '../../shared/types'
import type { KnowledgeBaseNoteState, KnowledgeBaseTask } from '../db/knowledge-base-types'
import { db } from '../db/schema'

export const useKnowledgeBasesStore = defineStore('knowledge-bases', () => {
  const books = ref<KnowledgeBase[]>([])
  const tocs = ref<KnowledgeBaseToc[]>([])
  const tasks = ref<KnowledgeBaseTask[]>([])
  const notes = ref<LocalNote[]>([])
  const noteStates = ref<KnowledgeBaseNoteState[]>([])
  const error = ref<string | null>(null)
  // The persistent sidebar only needs metadata; do not load note bodies/history there.
  function subscribeCatalog() {
    return liveQuery(() => db.knowledgeBases.toArray()).subscribe({
      next(data) { books.value = data },
      error(e) { error.value = e instanceof Error ? e.message : String(e) },
    })
  }
  function subscribe() {
    return liveQuery(async () => {
      const [books, tocs, tasks, noteStates] = await Promise.all([
        db.knowledgeBases.toArray(), db.knowledgeBaseTocs.toArray(), db.knowledgeBaseOutbox.toArray(), db.knowledgeBaseNoteStates.toArray(),
      ])
      const conflictTocs = tasks.flatMap(t => t.conflict ? [t.conflict.toc] : [])
      const ids = [...new Set([...tocs, ...conflictTocs].flatMap(t => t.nodes.flatMap(n => n.note_id ? [n.note_id] : [])))]
      const notes = (await db.notes.bulkGet(ids)).filter((n): n is LocalNote => !!n)
      return { books, tocs, tasks, notes, noteStates }
    }).subscribe({ next(data) { books.value = data.books; tocs.value = data.tocs; tasks.value = data.tasks; notes.value = data.notes; noteStates.value = data.noteStates; error.value = null },
      error(e) { error.value = e instanceof Error ? e.message : String(e) } })
  }
  return { books, tocs, tasks, notes, noteStates, error, subscribe, subscribeCatalog }
})
