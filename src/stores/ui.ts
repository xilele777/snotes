import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ListView } from '../db/repo'

/** 统计作为弹窗显示，不参与主界面的视图切换。 */
export type UiView = ListView | 'metrics'

/** <720px 时列表与编辑器互斥，这里是当前显示哪一格 */
export type MobilePane = 'list' | 'editor'

/** 覆盖在工作区之上的大弹窗：统计与设置各占一层导航历史，同一时刻只开一个 */
export type Overlay = 'stats' | 'settings'

/** 设置弹窗的分页 */
export type SettingsTab = 'appearance' | 'data' | 'shortcuts' | 'about'

export interface WorkspacePosition {
  view: UiView
  activeGroupId: string | null
  currentId: string | null
  query: string
  mobilePane: MobilePane
  scroll: { list: number; editor: number; groups: number }
}

export const useUiStore = defineStore('ui', () => {
  const view = ref<UiView>('all')
  const activeGroupId = ref<string | null>(null)
  const query = ref('')
  const syncing = ref(false)
  const lastSyncError = ref<string | null>(null)
  /** outbox 里 failed=1 的任务数，Task 20 的 push 每轮刷新，非零时界面要给出可见提示 */
  const failedCount = ref(0)
  /** ≤1020px 时侧栏是抽屉，这里是它的展开态；>1020px 侧栏常驻，该值不参与渲染 */
  const drawerOpen = ref(false)
  /** 移动端列表↔编辑器互斥（UI 规格 §2.3）；放进 store 才能被导航快照保存/恢复 */
  const mobilePane = ref<MobilePane>('list')
  /** 只影响布局，不销毁编辑器，避免切换专注模式打断输入。 */
  const focusMode = ref(false)
  /** 当前打开的大弹窗；null = 没有 */
  const overlay = ref<Overlay | null>(null)
  const settingsTab = ref<SettingsTab>('appearance')
  /**
   * 删除当前笔记的请求计数。快捷键只把它加一，NoteDetail 监听到变化就弹确认；
   * 手机上删除按钮收进了「更多」菜单，快捷键不能再靠点 DOM 上的按钮。
   */
  const trashRequest = ref(0)
  /** 服务端配置的回收站保留天数：null 未开启自动清理，undefined 尚未得知（还没同步过） */
  const trashRetentionDays = ref<number | null | undefined>(undefined)
  /** 离开笔记时仅保存位置，不缓存第二份列表或编辑器。 */
  const lastNotesPosition = ref<WorkspacePosition | null>(null)
  const restorePosition = ref<WorkspacePosition | null>(null)

  return { view, activeGroupId, query, syncing, lastSyncError, failedCount, drawerOpen, mobilePane, focusMode, overlay, settingsTab, trashRequest, trashRetentionDays, lastNotesPosition, restorePosition }
})
