import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { LocalNote } from '../../shared/types'
import * as repo from '../db/repo'
import type { ListView, NoteProps } from '../db/repo'
import { isMobile } from '../navigation'
import { useUiStore } from './ui'

export const useNotesStore = defineStore('notes', () => {
  const ui = useUiStore()
  const notes = ref<LocalNote[]>([])
  const currentId = ref<string | null>(null)
  const loadedKey = ref<string | null>(null)
  let loadSeq = 0

  function viewKey(): string {
    return `${ui.view}:${ui.activeGroupId ?? ''}`
  }

  /** 当前内存中的列表是否确实属于正在看的视图。 */
  const stale = computed(() => loadedKey.value !== viewKey())

  const current = computed(() => notes.value.find((n) => n.id === currentId.value))

  /**
   * 打开笔记（currentId 切到非 null）记一次本地统计：递增 open_count、刷新
   * last_open_time。纯本地行为，不动 update_time、不入 outbox，因此不污染
   * 列表排序与同步。同时把内存里这条的统计值就地更新，文档信息弹窗与统计页
   * 能立刻看到最新值，无需整表 load（load 会按 update_time 重排，反而抖动）。
   *
   * immediate 打开应用时 load() 默认选中第一条也会触发一次——那条本来就是被
   * 「打开」了，计数符合预期。切换到 null（删除/清空）不计。
   *
   * currentId 是稀有交互；用 sync watcher 保证「null -> id」即使发生在同一个
   * tick，也不会因为首尾值相同而被 Vue 合并掉这一次真实的状态迁移。
   */
  watch(currentId, (id) => {
    if (id === null) return
    void repo.openNote(id).then((result) => {
      if (!result) return
      const item = notes.value.find((n) => n.id === id)
      if (item) {
        item.open_count = result.open_count
        item.last_open_time = result.last_open_time
      }
    })
    const item = notes.value.find((n) => n.id === id)
    if (item) {
      item.open_count = (item.open_count ?? 0) + 1
      item.last_open_time = Date.now()
    }
  }, { flush: 'sync' })

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
    const seq = ++loadSeq
    const key = viewKey()
    // metrics 视图不经这里取数（MetricsView 直接调 apiMetrics），所以 types 收窄到列表视图是安全的
    const rows = await repo.listNotes({ view: ui.view as ListView, groupId: ui.activeGroupId })
    // 视图快速切换时，较早查询的结果不能覆盖较新的查询。
    if (seq !== loadSeq) return
    notes.value = rows
    loadedKey.value = key

    // 当前选中项必须始终在当前列表里。切视图、恢复、彻底删除、清空回收站都会让它落空，
    // 留着一个指不到任何笔记的 currentId，详情页就是一块永远空白的板子。
    if (currentId.value !== null && !notes.value.some((n) => n.id === currentId.value)) {
      currentId.value = null
    }

    // 桌面端同屏目录+详情，打开应用 / 切视图时若没选中项，默认选中列表第一条，
    // 详情区立刻有内容；移动端 <720px 目录与详情互斥，默认选中会直接把详情页顶成首屏。
    // 移动端保持 null，像便签那样先展示目录；currentId 失效落空时也不替它补选。
    if (currentId.value === null && notes.value.length > 0 && !isMobile()) {
      currentId.value = notes.value[0].id
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

  return { notes, currentId, current, visible, stale, load, create, saveBody, setProps, trash, recover, purge, purgeAll }
})
