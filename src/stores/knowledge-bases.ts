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
  /** 目录内笔记的正文（id -> text）：笔记本搜索与字数统计要扫正文，按 id 同表取 */
  const bodyText = ref<Map<string, string>>(new Map())
  const noteStates = ref<KnowledgeBaseNoteState[]>([])
  const error = ref<string | null>(null)
  // The persistent sidebar only needs metadata; do not load note bodies/history there.
  function subscribeCatalog() {
    return liveQuery(() => db.knowledgeBases.toArray()).subscribe({
      next(data) { books.value = data },
      error(e) { error.value = e instanceof Error ? e.message : String(e) },
    })
  }
  // 普通笔记只需要归属目录；不要为顶栏加载笔记本中的全部正文。
  function subscribeMembership() {
    return liveQuery(async () => ({ books: await db.knowledgeBases.toArray(), tocs: await db.knowledgeBaseTocs.toArray() }))
      .subscribe({
        next(data) { books.value = data.books; tocs.value = data.tocs },
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
      const [notes, bodies] = await Promise.all([
        db.notes.bulkGet(ids).then(rows => rows.filter((n): n is LocalNote => !!n)),
        db.bodies.bulkGet(ids),
      ])
      const bodyText = new Map(bodies.filter((row): row is NonNullable<typeof row> => !!row).map(row => [row.id, row.body]))
      return { books, tocs, tasks, notes, noteStates, bodyText }
    }).subscribe({ next(data) { books.value = data.books; tocs.value = data.tocs; tasks.value = data.tasks; notes.value = data.notes; noteStates.value = data.noteStates; bodyText.value = data.bodyText; error.value = null },
      error(e) { error.value = e instanceof Error ? e.message : String(e) } })
  }
  return { books, tocs, tasks, notes, bodyText, noteStates, error, subscribe, subscribeCatalog, subscribeMembership }
})
