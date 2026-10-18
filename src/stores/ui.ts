import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ListView } from '../db/repo'

/** 笔记内容视图；统计和设置由 workspacePage 保存，切换时保留编辑位置。 */
export type UiView = ListView | 'metrics' | 'knowledge-bases'

/** <720px 时列表与编辑器互斥，这里是当前显示哪一格 */
export type MobilePane = 'list' | 'editor'

/** 侧栏导航中的独立功能页面。 */
export type WorkspacePage = 'stats' | 'settings'

/** 设置页面的分页 */
export type SettingsTab = 'appearance' | 'data' | 'shortcuts' | 'agents' | 'about'

export interface WorkspacePosition {
  view: UiView
  activeGroupId: string | null
  activeKnowledgeBaseId?: string | null
  activeTocNodeId?: string | null
  collapsedKnowledgeBaseNodes?: string[]
  knowledgeBaseScroll?: number
  knowledgeBaseFilter?: 'active' | 'removed'
  currentId: string | null
  query: string
  mobilePane: MobilePane
  scroll: { list: number; editor: number; groups: number }
}

/** 服务端未告知时按默认 30 天计算回收站剩余天数 */
export const DEFAULT_TRASH_RETENTION_DAYS = 30

/**
 * 回收站里的笔记还剩几天被自动删除。进回收站的时间就是它的 update_time；
 * retention 为 null 表示服务端关闭了自动清理，返回 null；未知时按默认 30 天。
 */
export function trashDaysLeft(updateTime: number, retention: number | null | undefined, now = Date.now()): number | null {
  const days = retention === undefined ? DEFAULT_TRASH_RETENTION_DAYS : retention
  if (!days) return null
  return Math.max(0, Math.ceil((updateTime + days * 86_400_000 - now) / 86_400_000))
}

export const useUiStore = defineStore('ui', () => {
  const view = ref<UiView>('all')
  const activeGroupId = ref<string | null>(null)
  const activeKnowledgeBaseId = ref<string | null>(null)
  const knowledgeBaseFilter = ref<'active' | 'removed'>('active')
  const activeTocNodeId = ref<string | null>(null)
  const collapsedKnowledgeBaseNodes = ref<string[]>([])
  const knowledgeBaseSyncError = ref<string | null>(null)
  const query = ref('')
  const syncing = ref(false)
  const lastSyncError = ref<string | null>(null)
  /** outbox 里 failed=1 的任务数，Task 20 的 push 每轮刷新，非零时界面要给出可见提示 */
  const failedCount = ref(0)
  /** ≤1020px 时侧栏是抽屉，这里是它的展开态；>1020px 侧栏常驻，该值不参与渲染 */
  const drawerOpen = ref(false)
  /** 移动端列表↔编辑器互斥（UI 规格 §2.3）；放进 store 才能被导航快照保存/恢复 */
  const mobilePane = ref<MobilePane>('list')
  /** 当前功能页面；null 时展示原笔记或笔记本工作区。 */
  const workspacePage = ref<WorkspacePage | null>(null)
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

  return { view, activeGroupId, activeKnowledgeBaseId, knowledgeBaseFilter, activeTocNodeId, collapsedKnowledgeBaseNodes, knowledgeBaseSyncError, query, syncing, lastSyncError, failedCount, drawerOpen, mobilePane, workspacePage, settingsTab, trashRequest, trashRetentionDays, lastNotesPosition, restorePosition }
})
