import type { SettingsTab, UiView, WorkspacePage } from './stores/ui'

/** URL carries the destination; history.state also keeps the workspace and scroll position. */
export interface WorkspaceRoute {
  view: UiView
  activeGroupId: string | null
  activeKnowledgeBaseId?: string | null
  activeTocNodeId?: string | null
  currentId: string | null
  query: string
  workspacePage: WorkspacePage | null
  settingsTab?: SettingsTab
}

const views = ['all', 'star', 'group', 'hidden', 'trash', 'metrics', 'knowledge-bases'] as const
const settingsTabs = ['appearance', 'data', 'shortcuts', 'agents', 'about'] as const

export function isUiView(value: unknown): value is UiView {
  return views.some(view => view === value)
}

export function isSettingsTab(value: unknown): value is SettingsTab {
  return settingsTabs.some(tab => tab === value)
}

export function parseRoute(url: URL): WorkspaceRoute | null {
  let parts: string[]
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent) }
  catch { return null }
  const route: WorkspaceRoute = {
    view: 'all', activeGroupId: null, activeKnowledgeBaseId: null, activeTocNodeId: null,
    currentId: null, query: '', workspacePage: null, settingsTab: 'appearance',
  }
  const [page, id] = parts
  if (!page && parts.length === 0) { /* Home */ }
  else if (page === 'settings' && parts.length <= 2 && (!id || isSettingsTab(id))) {
    route.workspacePage = 'settings'
    route.settingsTab = isSettingsTab(id) ? id : 'appearance'
  } else if (page === 'stats' && parts.length === 1) route.workspacePage = 'stats'
  else if (page === 'notebooks' && parts.length <= 2) {
    route.view = 'knowledge-bases'
    route.activeKnowledgeBaseId = id ?? null
  } else if (page === 'groups' && parts.length === 2) {
    route.view = 'group'
    route.activeGroupId = id!
  } else if ((page === 'star' || page === 'hidden' || page === 'trash' || page === 'metrics') && parts.length === 1) {
    route.view = page
  } else return null

  if (!route.workspacePage && route.view !== 'metrics') {
    route.query = url.searchParams.get('q') ?? ''
    if (route.view !== 'knowledge-bases' || route.activeKnowledgeBaseId) route.currentId = url.searchParams.get('note') || null
    if (route.activeKnowledgeBaseId) route.activeTocNodeId = url.searchParams.get('node') || null
  }
  return route
}

export function routeUrl(route: WorkspaceRoute): string {
  if (route.workspacePage === 'settings') return `/settings/${route.settingsTab ?? 'appearance'}`
  if (route.workspacePage === 'stats') return '/stats'
  let path = '/'
  if (route.view === 'group' && route.activeGroupId) path = `/groups/${encodeURIComponent(route.activeGroupId)}`
  else if (route.view === 'knowledge-bases') path = `/notebooks${route.activeKnowledgeBaseId ? `/${encodeURIComponent(route.activeKnowledgeBaseId)}` : ''}`
  else if (route.view !== 'all' && route.view !== 'group') path = `/${route.view}`
  const params = new URLSearchParams()
  if (route.view !== 'metrics') {
    if (route.currentId && (route.view !== 'knowledge-bases' || route.activeKnowledgeBaseId)) params.set('note', route.currentId)
    if (route.activeKnowledgeBaseId && route.activeTocNodeId) params.set('node', route.activeTocNodeId)
    if (route.query) params.set('q', route.query)
  }
  return `${path}${params.size ? `?${params}` : ''}`
}
