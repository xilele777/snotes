import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LocalNote } from '../../shared/types'
import * as repo from '../db/repo'
import type { NoteProps } from '../db/repo'
import { useUiStore } from './ui'

export const useNotesStore = defineStore('notes', () => {
  const ui = useUiStore()
  const notes = ref<LocalNote[]>([])
  const currentId = ref<string | null>(null)

  const current = computed(() => notes.value.find((n) => n.id === currentId.value))

  const visible = computed(() => {
    const q = ui.query.trim().toLowerCase()
    if (!q) return notes.value

    const scored = notes.value
      .map((note) => {
        const inTitle = note.title.toLowerCase().includes(q)
        const inBody = note.body.toLowerCase().includes(q)
        return { note, rank: inTitle ? 0 : inBody ? 1 : -1 }
      })
      .filter((x) => x.rank >= 0)

    return scored
      .sort((a, b) => a.rank - b.rank || b.note.update_time - a.note.update_time)
      .map((x) => x.note)
  })

  async function load() {
    notes.value = await repo.listNotes({ view: ui.view, groupId: ui.activeGroupId })

    // 当前选中项必须始终在当前列表里。切视图、恢复、彻底删除、清空回收站都会让它落空，
    // 留着一个指不到任何笔记的 currentId，详情页就是一块永远空白的板子。
    if (currentId.value !== null && !notes.value.some((n) => n.id === currentId.value)) {
      currentId.value = null
    }
  }

  async function create() {
    const note = await repo.createNote('')
    await load()
    currentId.value = note.id
    return note
  }

  async function saveBody(id: string, content: string) {
    await repo.updateBody(id, content)
    await load()
  }

  async function setProps(id: string, props: NoteProps) {
    await repo.updateProps(id, props)
    await load()
  }

  async function trash(id: string) {
    await repo.trashNote(id)
    const wasCurrent = currentId.value === id
    await load()

    if (wasCurrent) {
      currentId.value = notes.value[0]?.id ?? null
    }
  }

  async function recover(id: string) {
    await repo.recoverNote(id)
    await load()
  }

  /** 回收站里的「彻底删除」：物理删除单条。currentId 的收尾交给 load() 的不变量。 */
  async function purge(id: string) {
    await repo.purgeNote(id)
    await load()
  }

  /**
   * 清空回收站（规格 §7.2 POST /api/trash/clean 的本地入口）。
   * 物理删除所有 invalid=1 的笔记并入队 scope='trash' 的 purge 任务，
   * 成功后重新 load 以刷新回收站视图（此时应只剩空列表）。
   */
  async function purgeAll() {
    await repo.purgeTrash()
    await load()
  }

  return { notes, currentId, current, visible, load, create, saveBody, setProps, trash, recover, purge, purgeAll }
})
