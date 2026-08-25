import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import type { MobilePane, UiView } from './stores/ui'

/**
 * Bug 2 手机端返回：用 History API 撑起一层轻量 in-app 导航栈，不引 vue-router。
 *
 * 每次会产生「层级变化」的动作（移动端进详情、开抽屉、切视图）之前，先把当前
 * 完整界面状态 pushState 入栈；系统返回 / PWA 独立窗口返回触发 popstate，恢复
 * 上一份快照。启动时只把根快照 replaceState 进当前条目，不再额外压「哨兵」：
 * 目录页（根界面）按系统返回时栈底已无更早条目，standalone PWA 自然退出回桌面，
 * 符合便签类应用的预期；进过详情 / 抽屉后再按返回则逐层弹栈回到目录页。
 */
export interface NavSnapshot {
  currentId: string | null
  view: UiView
  activeGroupId: string | null
  mobilePane: MobilePane
  drawerOpen: boolean
}

/** 取当前界面完整状态。必须每次现取：快照是「进入下一步之前」的那份。 */
function snapshot(): NavSnapshot {
  const ui = useUiStore()
  const notes = useNotesStore()
  return {
    currentId: notes.currentId,
    view: ui.view,
    activeGroupId: ui.activeGroupId,
    mobilePane: ui.mobilePane,
    drawerOpen: ui.drawerOpen,
  }
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
  if (history.state === null && document.readyState !== 'loading') {
    // 没先 initNavigation 就 push，会把第一条直接顶成「根」，返回时无处可退。
    // 常规路径都是从 initNavigation 之后走的，这里防御一下。
    history.replaceState(snapshot(), '')
  }
  history.pushState(snapshot(), '')
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
  ui.mobilePane = s.mobilePane
  ui.drawerOpen = s.drawerOpen
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
