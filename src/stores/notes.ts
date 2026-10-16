import { recordCloudSnapshot } from '../db/history'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { LocalNote } from '../../shared/types'
import * as repo from '../db/repo'
import type { ListView, NoteProps } from '../db/repo'
import { isMobile, pushNav } from '../navigation'
import { useUiStore } from './ui'
import { matchesAll, splitTerms } from '../components/SearchBar'
import { db } from '../db/schema'
import { addKnowledgeBaseNode } from '../db/knowledge-base-repo'
import { workspacePreferences } from '../workspace-preferences'
import { notify } from '../notify'

export const useNotesStore = defineStore('notes', () => {
  const ui = useUiStore()
  const notes = ref<LocalNote[]>([])
  const currentId = ref<string | null>(null)
  // 属性变更使当前笔记离开筛选结果时，继续编辑到用户主动离开该视图。
  const retained = ref<LocalNote | null>(null)
  let retainedKey: string | null = null
  const loadedKey = ref<string | null>(null)
  let loadSeq = 0

  function viewKey(): string {
    return `${ui.view}:${ui.view === 'knowledge-bases' ? ui.activeKnowledgeBaseId ?? '' : ui.activeGroupId ?? ''}`
  }

  /** 当前内存中的列表是否确实属于正在看的视图。 */
  const stale = computed(() => loadedKey.value !== viewKey())

  const current = computed(() => notes.value.find((n) => n.id === currentId.value) ?? (retained.value?.id === currentId.value && retainedKey === viewKey() ? retained.value : undefined))

  /**
   * 打开笔记（currentId 切到非 null）记一次本地统计：递增 open_count、刷新
   * last_open_time。纯本地行为，不动 update_time、不入 outbox，因此不污染
   * 列表排序与同步。
   *
   * 只有 open() 这条「用户主动打开」的路径会计数。启动时替用户选中的第一条、
   * 切视图时补选、新建后跳过去、返回时恢复上次位置都直接改 currentId：
   * 它们不是「我打开了这篇文章」，计进去会让第一篇笔记的次数无限膨胀。
   *
   * pendingCount 是个一次性开关：open() 在赋值前打开它，watcher 用 sync flush
   * 在同一 tick 里消费掉。这样「null -> id」即使发生在同一个 tick 也不会被 Vue
   * 合并掉，而静默赋值永远不会误计。
   */
  let pendingCount = false

  watch(currentId, (id) => {
    const count = pendingCount
    pendingCount = false
    if (id === null || !count) return
    void repo.openNote(id).then((result) => {
      if (!result) return
      const item = notes.value.find((n) => n.id === id)
      if (!item) return
      // 只前进不后退：并发打开时晚到的旧结果不能把界面上的数字拽回去
      if ((result.open_count ?? 0) >= (item.open_count ?? 0)) {
        item.open_count = result.open_count
        item.last_open_time = result.last_open_time
      }
    })
  }, { flush: 'sync' })

  /**
   * 用户主动打开一条笔记：选中它并记一次打开次数。
   * 已经在看这条时不产生状态迁移，也就不算一次新的打开。
   */
  function open(id: string) {
    if (currentId.value === id) return
    pendingCount = true
    currentId.value = id
  }

  /**
   * 搜索：空格分隔的多个关键词取交集，标题与正文合起来都包含才算命中。
   * 全部关键词都落在标题里的排最前，其余按更新时间倒序。
   */
  const visible = computed(() => {
    const sort = workspacePreferences.value.noteSort
    const compare = (a: LocalNote, b: LocalNote) => b.top - a.top ||
      (sort === 'title' ? (a.title || '无标题').localeCompare(b.title || '无标题', 'zh-CN') : sort === 'created' ? b.create_time - a.create_time : b.update_time - a.update_time) || a.id.localeCompare(b.id)
    const terms = splitTerms(ui.query)
    if (terms.length === 0) return ui.view === 'trash' || ui.view === 'knowledge-bases' ? notes.value : [...notes.value].sort(compare)

    const scored = notes.value
      .map((note) => {
        const inTitle = matchesAll(note.title, terms)
        const inAny = inTitle || matchesAll(`${note.title}
${note.body}`, terms)
        return { note, rank: inTitle ? 0 : inAny ? 1 : -1 }
      })
      .filter((x) => x.rank >= 0)

    return scored
      .sort((a, b) => a.rank - b.rank || compare(a.note, b.note))
      .map((x) => x.note)
  })

  async function load() {
    // 取数期间视图可能又变了（挂载瞬间的 watcher 与切视图几乎同时触发）。此时这份结果
    // 已经过期，但它可能已经是最新的那个 seq，让 seq 守卫放行的话列表就空着没人再补，
    // 所以这里就着重取一次，直到「取数前后是同一个视图」为止。
    for (;;) {
      const seq = ++loadSeq
      const key = viewKey()
      let rows: LocalNote[]
      try {
        // metrics 视图不经这里取数（MetricsView 直接调 apiMetrics），所以 types 收窄到列表视图是安全的
        const toc = ui.view === 'knowledge-bases' && ui.activeKnowledgeBaseId ? await db.knowledgeBaseTocs.get(ui.activeKnowledgeBaseId) : undefined
        rows = ui.view === 'knowledge-bases'
          ? (await db.notes.bulkGet(toc?.nodes.flatMap(n => n.note_id ? [n.note_id] : []) ?? [])).filter((n): n is LocalNote => !!n && n.invalid === 0)
          : await repo.listNotes({ view: ui.view as ListView, groupId: ui.activeGroupId })
      } catch (e) {
        // 组件已经卸载 / 测试环境把库关了：这次取数已经没有去处，静默收场。
        // 重取循环会让同一次 load 多飞几次查询，落在这里的可能性比原来高。
        if (e instanceof Error && e.name === 'DatabaseClosedError') return
        throw e
      }
      const selected = retained.value?.id === currentId.value && retainedKey === key
        ? await repo.getNote(retained.value.id) : undefined
      // 视图快速切换时，较早查询的结果不能覆盖较新的查询。
      if (seq !== loadSeq) return
      if (key !== viewKey()) continue
      retained.value = selected?.invalid === 0 && selected.id === currentId.value ? selected : null
      notes.value = rows
      loadedKey.value = key
      break
    }

    // 当前选中项须在列表或当前视图保留的编辑内容中。切视图、删除等操作使其失效时，
    // 留着一个指不到任何笔记的 currentId，详情页就是一块永远空白的板子。
    if (currentId.value !== null && !notes.value.some((n) => n.id === currentId.value) && !retained.value) {
      currentId.value = null
    }

    // 桌面端同屏目录+详情，打开应用 / 切视图时若没选中项，默认选中列表第一条，
    // 详情区立刻有内容；移动端 <720px 目录与详情互斥，默认选中会直接把详情页顶成首屏。
    // 移动端保持 null，像便签那样先展示目录；currentId 失效落空时也不替它补选。
    if (currentId.value === null && notes.value.length > 0 && !isMobile() && ui.view !== 'knowledge-bases') {
      currentId.value = notes.value[0].id
    }
  }

  /** 新建的笔记该落在哪个分组：分组视图里就地建在该分组，其它视图留空 */
  function createGroupId(): string | null {
    if (ui.view === 'group' && typeof ui.activeGroupId === 'string') return ui.activeGroupId
    return null
  }

  async function create(options?: { knowledgeBaseParentId?: string | null }) {
    const groupId = createGroupId()
    const note = await repo.createNote('', groupId ? { group_id: groupId } : {})
    if (ui.view === 'knowledge-bases' && ui.activeKnowledgeBaseId) {
      // Creation location comes from the action, never from the row being browsed.
      const parent = options?.knowledgeBaseParentId ?? null
      ui.activeTocNodeId = await addKnowledgeBaseNode(ui.activeKnowledgeBaseId, { kind: 'note', note_id: note.id, title: null }, parent)
      ui.collapsedKnowledgeBaseNodes = ui.collapsedKnowledgeBaseNodes.filter(id => id !== parent)
      if (isMobile()) pushNav()
      ui.query = ''
      await load()
      currentId.value = note.id
      return note
    }
    // 分组内就地新建；星标、回收站和监控视图的新笔记统一显示在全部笔记里。
    const viewSwitches = ui.view !== 'all' && ui.view !== 'group'
    if (viewSwitches) {
      // 视图切换前把当前态入栈，返回键退回新建前的筛选视图而不是直接退出应用
      pushNav()
      ui.view = 'all'
      ui.activeGroupId = null
    } else if (isMobile()) {
      // 移动端列表与编辑器互斥，新建后必然切进详情（currentId 一落，编辑器占整屏），
      // 入栈让系统返回键先回到目录页而不是退出应用
      pushNav()
    }
    ui.query = ''
    ui.drawerOpen = false
    await load()
    currentId.value = note.id
    return note
  }

  /** content 改自 base（编辑器认为库里此刻的正文）；库中被别处改写过时由 repo 另存冲突副本 */
  async function saveBody(id: string, content: string, base?: string) {
    await repo.updateBody(id, content, base)
    await load()
  }

  async function setProps(id: string, props: NoteProps) {
    if (id === currentId.value && current.value && ('group_id' in props || 'home_hidden' in props || 'star' in props)) {
      retained.value = current.value
      retainedKey = viewKey()
    }
    await repo.updateProps(id, props)
    await load()
  }

  /** 从历史（本机或云端）恢复某一版正文；repo 先把当前正文存为本机快照，这里再补录一份到云端 */
  async function restoreHistory(id: string, body: string) {
    const before = await repo.getNote(id)
    const ok = await repo.restoreHistoryBody(id, body)
    if (!ok) return false
    if (before && before.body.trim() && before.body !== body) await recordCloudSnapshot(id, before.body, before.update_time)
    await load()
    return true
  }

  async function trash(id: string) {
    await repo.trashNote(id)
    const wasCurrent = currentId.value === id
    await load()

    if (wasCurrent && ui.view !== 'knowledge-bases') {
      currentId.value = notes.value[0]?.id ?? null
    }
  }

  async function trashWithUndo(id: string) {
    try {
      await trash(id)
      notify('笔记已移入回收站', { label: '撤销', run: async () => { await recover(id); notify('已恢复笔记') } })
    } catch (error) { notify(error instanceof Error ? error.message : String(error)) }
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

  return { notes, currentId, current, visible, stale, load, create, open, saveBody, setProps, restoreHistory, trash, trashWithUndo, recover, purge, purgeAll }
})
