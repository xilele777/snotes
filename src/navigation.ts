import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import type { Overlay, SettingsTab, UiView, WorkspacePosition } from './stores/ui'
import type { ListView } from './db/repo'

/**
 * Bug 2 手机端返回：用 History API 撑起一层轻量 in-app 导航栈，不引 vue-router。
 *
 * 每次会产生「层级变化」的动作（移动端进详情、开抽屉、切视图）之前，先把当前
 * 完整界面状态 pushState 入栈；系统返回 / PWA 独立窗口返回触发 popstate，恢复
 * 上一份快照。启动时只把根快照 replaceState 进当前条目，不再额外压「哨兵」：
 * 目录页（根界面）按系统返回时栈底已无更早条目，standalone PWA 自然退出回桌面，
 * 符合便签类应用的预期；进过详情 / 抽屉后再按返回则逐层弹栈回到目录页。
 */
export interface NavSnapshot extends WorkspacePosition {
  drawerOpen: boolean
  overlay: Overlay | null
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
    query: ui.query,
    mobilePane: ui.mobilePane,
    drawerOpen: ui.drawerOpen,
    overlay: ui.overlay,
    scroll: {
      list: document.querySelector('.note-list')?.scrollTop ?? 0,
      editor: document.querySelector('.editor-body')?.scrollTop ?? 0,
      groups: document.querySelector('.groups')?.scrollTop ?? 0,
    },
  }
}

export function isNotesView(view: UiView): boolean {
  return view === 'all' || view === 'star' || view === 'group'
}

export async function switchListView(view: ListView, groupId: string | null = null) {
  const ui = useUiStore()
  ui.focusMode = false
  if (ui.view === view && ui.activeGroupId === groupId) {
    ui.drawerOpen = false
    return
  }
  if (isNotesView(ui.view)) ui.lastNotesPosition = snapshot()
  pushNav()
  if (ui.view === 'trash' || view === 'trash') ui.query = ''
  ui.restorePosition = null
  ui.view = view
  ui.activeGroupId = groupId
  ui.drawerOpen = false
  await useNotesStore().load()
}

/** 图标栏回到离开前的笔记位置；在笔记页内点击不会重置分组。 */
export async function showNotes() {
  const ui = useUiStore()
  if (isNotesView(ui.view)) {
    ui.drawerOpen = false
    return
  }
  const saved = ui.lastNotesPosition
  pushNav()
  restore({
    ...(saved ?? { view: 'all', activeGroupId: null, currentId: null, query: '', mobilePane: 'list', scroll: { list: 0, editor: 0, groups: 0 } }),
    drawerOpen: false,
    overlay: null,
  })
  await useNotesStore().load()
}

/**
 * 大弹窗（统计、设置）独占一层历史；关闭或系统返回都回到原工作区。
 * 已经开着同一个时只切分页；开着另一个时先原地替换，不再多压一层。
 */
export function openOverlay(kind: Overlay, tab?: SettingsTab) {
  const ui = useUiStore()
  if (tab) ui.settingsTab = tab
  else if (kind === 'settings') ui.settingsTab = 'appearance'
  if (ui.overlay === kind) return
  ui.drawerOpen = false
  if (!ui.overlay) pushNav()
  ui.overlay = kind
  history.replaceState(snapshot(), '')
}

export function closeOverlay() {
  const ui = useUiStore()
  if (!ui.overlay) return
  if (history.state?.overlay) popNav()
  else ui.overlay = null
}

/** @deprecated 保留给旧调用点；等同于 openOverlay('stats') */
export function openStats() {
  openOverlay('stats')
}

/** @deprecated 等同于 closeOverlay() */
export function closeStats() {
  closeOverlay()
}

/** 榜单中的笔记是一次明确跳转，用目标笔记替换弹窗这层历史。 */
export async function openStatsNote(id: string) {
  const ui = useUiStore()
  const notes = useNotesStore()
  ui.overlay = null
  ui.focusMode = false
  ui.drawerOpen = false
  ui.restorePosition = null
  ui.view = 'all'
  ui.activeGroupId = null
  ui.query = ''
  notes.currentId = id
  ui.mobilePane = 'editor'
  await notes.load()
  if (ui.view === 'all' && notes.currentId === id) history.replaceState(snapshot(), '')
}

/** <720px 的移动端布局：只有在这里，「进详情」才是一层真正的界面切换 */
export function isMobile(): boolean {
  return window.matchMedia('(max-width: 720px)').matches
}

let initialized = false

export function initNavigation() {
  // 根快照写进当前条目。不再压哨兵：目录页按返回时栈底就是它，
  // 没有更早条目可退，standalone PWA 直接退出回桌面，不再被 forward 挡住。
  history.replaceState(snapshot(), '')

  if (initialized) return
  initialized = true
  window.addEventListener('popstate', onPopState)
}

/** 界面层级变化前调用：把当前态压栈，随后再改状态 */
export function pushNav() {
  // 桌面选中笔记和滚动不单独入栈，离开时更新当前条目才能准确返回。
  const current = snapshot()
  history.replaceState(current, '')
  history.pushState(current, '')
}

/** 返回上一级：走 history.back()，由 popstate 统一恢复 */
export function popNav() {
  history.back()
}

/** NoteDetail 的「返回列表」按钮 / 移动端编辑态返回：语义上就是弹一层 */
export function backToList() {
  popNav()
}

/** 开抽屉：先入栈再展开，这样返回能收回抽屉而不是退出应用 */
export function openDrawer() {
  pushNav()
  useUiStore().drawerOpen = true
}

function restore(s: NavSnapshot) {
  const ui = useUiStore()
  const notes = useNotesStore()
  // 先恢复 currentId（它的 watcher 会同步 mobilePane），再显式覆盖 mobilePane，
  // 顺序保证了快照里两个字段都不会被 watcher 的中间态盖掉。
  notes.currentId = s.currentId
  ui.view = s.view
  ui.activeGroupId = s.activeGroupId
  ui.query = s.query ?? ''
  ui.mobilePane = s.mobilePane
  ui.drawerOpen = s.drawerOpen
  ui.overlay = s.overlay ?? (s.statsOpen ? 'stats' : null)
  ui.restorePosition = { ...s, query: ui.query, scroll: s.scroll ?? { list: 0, editor: 0, groups: 0 } }
}

/** 防重入：双击系统返回时 popstate 可能在同一任务里连发两次，第二次直接忽略 */
let popping = false

function onPopState(e: PopStateEvent) {
  if (popping) return
  popping = true
  queueMicrotask(() => {
    popping = false
  })

  const state = e.state as NavSnapshot | null

  // 栈底就是根快照；目录页按返回时浏览器已无更早条目，会直接退出，
  // 不会把 null 传到这里。这里仅作防御：真出现 null 就什么都不做，不 forward。
  if (state === null) return

  restore(state)
}
