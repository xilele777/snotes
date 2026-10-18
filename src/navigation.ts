import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import type { WorkspacePage, SettingsTab, UiView, WorkspacePosition } from './stores/ui'
import type { ListView } from './db/repo'
import { getNote, isNoteHiddenFromHome } from './db/repo'
import { nextTick, watch, type WatchStopHandle } from 'vue'
import { db } from './db/schema'
import { notify } from './notify'
import { isSettingsTab, isUiView, parseRoute, routeUrl } from './routes'
import { updateWorkspacePreferences } from './workspace-preferences'

/**
 * History API 导航：URL 保存页面地址，快照保存工作区与滚动位置。
 *
 * 每次会产生「层级变化」的动作（移动端进详情、开抽屉、切视图）之前，先把当前
 * 完整界面状态 pushState 入栈；系统返回 / PWA 独立窗口返回触发 popstate，恢复
 * 上一份快照。启动时先恢复当前地址与快照，只 replace 当前条目，不额外压「哨兵」：
 * 目录页（根界面）按系统返回时栈底已无更早条目，standalone PWA 自然退出回桌面，
 * 符合便签类应用的预期；进过详情 / 抽屉后再按返回则逐层弹栈回到目录页。
 */
export interface NavSnapshot extends WorkspacePosition {
  settingsTab?: SettingsTab
  depth?: number
  drawerOpen: boolean
  workspacePage: WorkspacePage | null
  /** 兼容旧版弹窗导航快照。 */
  overlay?: WorkspacePage | null
  /** v0.13 及之前的快照字段；只在恢复旧条目时读取 */
  statsOpen?: boolean
}

/** 取当前界面完整状态。必须每次现取：快照是「进入下一步之前」的那份。 */
function snapshot(): NavSnapshot {
  const ui = useUiStore()
  const notes = useNotesStore()
  return {
    currentId: notes.currentId,
    view: ui.view,
    activeGroupId: ui.activeGroupId,
    activeKnowledgeBaseId: ui.activeKnowledgeBaseId,
    knowledgeBaseFilter: ui.knowledgeBaseFilter,
    activeTocNodeId: ui.activeTocNodeId,
    collapsedKnowledgeBaseNodes: [...ui.collapsedKnowledgeBaseNodes],
    knowledgeBaseScroll: document.querySelector('.knowledge-base-tree')?.scrollTop ?? 0,
    query: ui.query,
    mobilePane: ui.mobilePane,
    drawerOpen: ui.drawerOpen,
    workspacePage: ui.workspacePage,
    settingsTab: ui.settingsTab,
    depth: navigationDepth,
    scroll: {
      list: document.querySelector('.note-list')?.scrollTop ?? 0,
      editor: document.querySelector('.editor-body')?.scrollTop ?? 0,
      groups: document.querySelector('.sidebar-scroll, .groups')?.scrollTop ?? 0,
    },
  }
}

export function isNotesView(view: UiView): boolean {
  return view === 'all' || view === 'star' || view === 'group' || view === 'hidden'
}

let navigationGeneration = 0
let navigationDepth = 0

function replaceSnapshot(state = snapshot()) {
  history.replaceState(state, '', routeUrl(state))
}

export async function switchListView(view: ListView, groupId: string | null = null) {
  updateWorkspacePreferences({ listCollapsed: false })
  navigationGeneration++
  const ui = useUiStore()
  ui.focusMode = false
  if (!ui.workspacePage && ui.view === view && ui.activeGroupId === groupId) {
    ui.drawerOpen = false
    return
  }
  if (isNotesView(ui.view) && !ui.workspacePage) ui.lastNotesPosition = snapshot()
  pushNav()
  ui.workspacePage = null
  if (ui.view === 'trash' || view === 'trash' || ui.view === 'knowledge-bases') ui.query = ''
  ui.restorePosition = null
  ui.view = view
  ui.activeGroupId = groupId
  ui.activeKnowledgeBaseId = null
  ui.activeTocNodeId = null
  ui.drawerOpen = false
  if (isMobile()) { useNotesStore().currentId = null; ui.mobilePane = 'list' }
  await useNotesStore().load()
}

/** 图标栏回到离开前的笔记位置；在笔记页内点击不会重置分组。 */
export async function showNotes() {
  updateWorkspacePreferences({ listCollapsed: false })
  navigationGeneration++
  const ui = useUiStore()
  if (isNotesView(ui.view)) {
    if (ui.workspacePage) { pushNav(); ui.workspacePage = null }
    ui.drawerOpen = false
    return
  }
  const saved = ui.lastNotesPosition
  pushNav()
  restore({
    ...(saved ?? { view: 'all', activeGroupId: null, currentId: null, query: '', mobilePane: 'list', scroll: { list: 0, editor: 0, groups: 0 } }),
    drawerOpen: false,
    workspacePage: null,
  })
  await useNotesStore().load()
}

export async function showKnowledgeBases(id: string | null = null) {
  updateWorkspacePreferences({ listCollapsed: false })
  navigationGeneration++
  const ui = useUiStore()
  if (!ui.workspacePage && ui.view === 'knowledge-bases' && ui.activeKnowledgeBaseId === id && ui.knowledgeBaseFilter === 'active') { ui.drawerOpen = false; return }
  if (isNotesView(ui.view) && !ui.workspacePage) ui.lastNotesPosition = snapshot()
  pushNav()
  ui.workspacePage = null
  ui.focusMode = false
  ui.view = 'knowledge-bases'
  ui.activeKnowledgeBaseId = id
  ui.activeGroupId = null
  ui.knowledgeBaseFilter = 'active'
  ui.activeTocNodeId = null
  ui.query = ''
  ui.drawerOpen = false
  ui.restorePosition = null
  useNotesStore().currentId = null
  ui.mobilePane = 'list'
  await useNotesStore().load()
}

/** Open an Agent result after the caller has completed the initial sync. */
export async function openNotebookLink(bookId: string, noteId: string | null) {
  const book = await db.knowledgeBases.get(bookId)
  if (!book || book.invalid || book.deleted) { notify('笔记本不存在或尚未同步，请联网后重试。'); return }
  const toc = await db.knowledgeBaseTocs.get(bookId)
  const node = noteId ? toc?.nodes.find(node => node.note_id === noteId) : null
  const note = noteId ? await db.notes.get(noteId) : null
  await showKnowledgeBases(bookId)
  if (!noteId) return
  if (!node || !note || note.invalid) { notify('笔记已移出、删除或尚未同步。'); return }
  const ui = useUiStore()
  ui.collapsedKnowledgeBaseNodes = []
  ui.activeTocNodeId = node.id
  useNotesStore().open(noteId)
  ui.mobilePane = 'editor'
}

/** A management link replaces the settings layer so Back returns to its original workspace. */
export async function openManagedView(target: 'hidden' | 'trash') {
  navigationGeneration++
  const ui = useUiStore()
  const notes = useNotesStore()
  if (!ui.workspacePage) pushNav()
  ui.workspacePage = null
  ui.focusMode = false
  ui.drawerOpen = false
  ui.restorePosition = null
  ui.query = ''
  ui.activeGroupId = null
  ui.activeKnowledgeBaseId = null
  ui.activeTocNodeId = null
  ui.knowledgeBaseFilter = 'active'
  ui.view = target
  notes.currentId = null
  ui.mobilePane = 'list'
  await notes.load()
  if (!ui.workspacePage && ui.view === target) {
    replaceSnapshot()
    await nextTick()
    document.querySelector<HTMLElement>('.list-pane .header-title, .kb-header h2')?.focus({ preventScroll: true })
  }
}

/**
 * 统计、设置作为独立工作区页面，保留原笔记位置和编辑器实例。
 * 页面之间切换替换当前条目，返回按钮和浏览器返回都回到原工作区。
 */
export function openWorkspacePage(kind: WorkspacePage, tab?: SettingsTab) {
  navigationGeneration++
  const ui = useUiStore()
  if (tab) ui.settingsTab = tab
  else if (kind === 'settings') ui.settingsTab = 'appearance'
  if (ui.workspacePage === kind) return
  ui.drawerOpen = false
  ui.focusMode = false
  if (!ui.workspacePage) pushNav()
  ui.workspacePage = kind
  replaceSnapshot()
}

export function closeWorkspacePage() {
  navigationGeneration++
  const ui = useUiStore()
  if (!ui.workspacePage) return
  if (navigationDepth > 0 && history.state?.workspacePage) popNav()
  else ui.workspacePage = null
}

/** @deprecated 保留给旧调用点；等同于 openWorkspacePage('stats') */
export function openStats() {
  openWorkspacePage('stats')
}

/** @deprecated 等同于 closeWorkspacePage() */
export function closeStats() {
  closeWorkspacePage()
}

/** 榜单中的笔记是一次明确跳转，用目标笔记替换统计页这层历史。 */
export async function openStatsNote(id: string) {
  const generation = ++navigationGeneration
  const ui = useUiStore()
  const notes = useNotesStore()
  ui.workspacePage = null
  ui.focusMode = false
  ui.drawerOpen = false
  ui.restorePosition = null
  ui.query = ''
  // 不上首页的笔记不在「全部笔记」里，直接跳过去会被 load() 的
  // 「选中项必须在当前列表里」不变量清掉，落到别的笔记上。
  const target = await getNote(id)
  const hidden = target ? await isNoteHiddenFromHome(target) : false
  if (generation !== navigationGeneration) return
  ui.activeKnowledgeBaseId = null
  ui.activeTocNodeId = null
  ui.view = hidden ? 'hidden' : 'all'
  ui.activeGroupId = null
  notes.open(id)
  ui.mobilePane = 'editor'
  await notes.load()
  if (ui.view === (hidden ? 'hidden' : 'all') && notes.currentId === id) replaceSnapshot()
}

/** <720px 的移动端布局：只有在这里，「进详情」才是一层真正的界面切换 */
export function isMobile(): boolean {
  return window.matchMedia('(max-width: 720px)').matches
}

let initialized = false
let navigationStore: ReturnType<typeof useUiStore> | undefined
let stopWatching: WatchStopHandle | undefined

function isSnapshot(value: unknown): value is NavSnapshot {
  if (!value || typeof value !== 'object') return false
  const state = value as NavSnapshot
  return isUiView(state.view) && (state.currentId === null || typeof state.currentId === 'string')
    && (state.mobilePane === 'list' || state.mobilePane === 'editor')
    && (state.activeGroupId === null || typeof state.activeGroupId === 'string')
}

function restoreLocation(state: unknown) {
  const url = new URL(location.href)
  const route = parseRoute(url)
  // Older releases kept all destinations at /. Accept their snapshots on upgrade.
  if (isSnapshot(state) && route && (routeUrl(state) === routeUrl(route) || (url.pathname === '/' && !url.search))) {
    restore(state)
  } else if (route && (url.pathname !== '/' || url.search)) {
    restore({ ...route, drawerOpen: false, mobilePane: route.currentId ? 'editor' : 'list', scroll: { list: 0, editor: 0, groups: 0 } })
  }
}

export function initNavigation() {
  const ui = useUiStore()
  if (navigationStore === ui) return
  stopWatching?.()
  navigationStore = ui
  navigationGeneration++
  navigationDepth = 0
  restoreLocation(history.state)
  const notes = useNotesStore()
  if (ui.restorePosition) notes.beginSelectionRestore()
  replaceSnapshot()
  // Batch synchronous destination changes, including desktop note selection and settings tabs.
  stopWatching = watch(() => [
    ui.view, ui.activeGroupId, ui.activeKnowledgeBaseId, ui.activeTocNodeId,
    ui.query, ui.workspacePage, ui.settingsTab, ui.mobilePane, ui.drawerOpen,
    ui.collapsedKnowledgeBaseNodes.slice(), notes.currentId,
  ], () => replaceSnapshot())

  if (initialized) return
  initialized = true
  window.addEventListener('popstate', onPopState)
}

/** 界面层级变化前调用：把当前态压栈，随后再改状态 */
export function pushNav() {
  // 桌面选中笔记和滚动不单独入栈，离开时更新当前条目才能准确返回。
  const current = snapshot()
  replaceSnapshot(current)
  navigationDepth++
  history.pushState({ ...current, depth: navigationDepth }, '', routeUrl(current))
  const generation = ++navigationGeneration
  // Callers synchronously set the destination after pushNav. Persist that
  // destination too, otherwise Forward replays the pre-navigation snapshot.
  queueMicrotask(() => {
    if (generation === navigationGeneration) replaceSnapshot()
  })
}

/** 返回上一级：走 history.back()，由 popstate 统一恢复 */
export function popNav() {
  navigationGeneration++
  history.back()
}

/** NoteDetail 的「返回列表」按钮 / 移动端编辑态返回：语义上就是弹一层 */
export function backToList() {
  if (navigationDepth > 0) popNav()
  else {
    useNotesStore().currentId = null
    useUiStore().mobilePane = 'list'
  }
}

/** 开抽屉：先入栈再展开，这样返回能收回抽屉而不是退出应用 */
export function openDrawer() {
  pushNav()
  useUiStore().drawerOpen = true
}

function restore(s: NavSnapshot) {
  const ui = useUiStore()
  const notes = useNotesStore()
  const previousPage = ui.workspacePage
  navigationDepth = Math.max(0, s.depth ?? 0)
  // 先恢复 currentId（它的 watcher 会同步 mobilePane），再显式覆盖 mobilePane，
  // 顺序保证了快照里两个字段都不会被 watcher 的中间态盖掉。
  notes.currentId = s.currentId
  ui.view = s.view
  ui.activeGroupId = s.activeGroupId
  ui.activeKnowledgeBaseId = s.activeKnowledgeBaseId ?? null
  ui.knowledgeBaseFilter = 'active'
  ui.activeTocNodeId = s.activeTocNodeId ?? null
  ui.collapsedKnowledgeBaseNodes = s.collapsedKnowledgeBaseNodes ?? []
  ui.query = s.query ?? ''
  ui.mobilePane = s.mobilePane
  ui.drawerOpen = s.drawerOpen
  ui.workspacePage = s.workspacePage ?? s.overlay ?? (s.statsOpen ? 'stats' : null)
  if (isSettingsTab(s.settingsTab)) ui.settingsTab = s.settingsTab
  ui.restorePosition = { ...s, query: ui.query, scroll: s.scroll ?? { list: 0, editor: 0, groups: 0 } }
  if (previousPage && !ui.workspacePage && !ui.drawerOpen) {
    void nextTick(() => {
      const candidates = document.querySelectorAll<HTMLElement>(`[data-view="${previousPage}"].sidebar-tool, .drawer-btn, .back-btn`)
      Array.from(candidates).find(el => el.getClientRects().length && !el.closest<HTMLElement>('[inert]')?.inert)?.focus({ preventScroll: true })
    })
  }
}

/** 防重入：双击系统返回时 popstate 可能在同一任务里连发两次，第二次直接忽略 */
let popping = false

function onPopState(e: PopStateEvent) {
  navigationGeneration++
  if (popping) return
  popping = true
  queueMicrotask(() => {
    popping = false
  })

  const state = e.state as NavSnapshot | null

  // 栈底就是根快照；目录页按返回时浏览器已无更早条目，会直接退出，
  // 不会把 null 传到这里。这里仅作防御：真出现 null 就什么都不做，不 forward。
  if (!isSnapshot(state)) {
    if (state === null) return
    restoreLocation(null)
    return
  }

  restore(state)
}
