import { ref } from 'vue'

export type NoteSort = 'updated' | 'created' | 'title'
export type LibrarySort = 'updated' | 'name'
export interface WorkspacePreferences {
  groupsCollapsed: boolean
  librariesCollapsed: boolean
  sidebarCollapsed: boolean
  listCollapsed: boolean
  sidebarWidth: number
  listWidth: number
  pinnedKnowledgeBaseIds: string[]
  noteSort: NoteSort
  librarySort: LibrarySort
}
export const WORKSPACE_PREFERENCES_KEY = 'snotes_workspace_preferences'
export const WORKSPACE_WIDTHS = {
  sidebar: { min: 200, max: 340, default: 232 },
  list: { min: 260, max: 520, default: 336 },
} as const
function parseWidth(value: unknown, range: { min: number; max: number; default: number }) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(range.max, Math.max(range.min, value))) : range.default
}
export function parseWorkspacePreferences(raw: string | null): WorkspacePreferences {
  let value: Partial<WorkspacePreferences> = {}
  try { value = JSON.parse(raw ?? '{}') ?? {} } catch { /* Corrupt preferences never block opening notes. */ }
  return {
    groupsCollapsed: value.groupsCollapsed === true,
    librariesCollapsed: value.librariesCollapsed === true,
    sidebarCollapsed: value.sidebarCollapsed === true,
    listCollapsed: value.listCollapsed === true,
    sidebarWidth: parseWidth(value.sidebarWidth, WORKSPACE_WIDTHS.sidebar),
    listWidth: parseWidth(value.listWidth, WORKSPACE_WIDTHS.list),
    pinnedKnowledgeBaseIds: Array.isArray(value.pinnedKnowledgeBaseIds) ? [...new Set(value.pinnedKnowledgeBaseIds.filter((id): id is string => typeof id === 'string'))].slice(0, 500) : [],
    noteSort: value.noteSort === 'created' || value.noteSort === 'title' ? value.noteSort : 'updated',
    librarySort: value.librarySort === 'name' ? 'name' : 'updated',
  }
}
function read() {
  try { return localStorage.getItem(WORKSPACE_PREFERENCES_KEY) } catch { return null }
}
export const workspacePreferences = ref(parseWorkspacePreferences(read()))
export function updateWorkspacePreferences(patch: Partial<WorkspacePreferences>) {
  workspacePreferences.value = parseWorkspacePreferences(JSON.stringify({ ...workspacePreferences.value, ...patch }))
  try { localStorage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify(workspacePreferences.value)) } catch { /* The current session remains usable without storage. */ }
}
export function togglePinnedKnowledgeBase(id: string) {
  const ids = workspacePreferences.value.pinnedKnowledgeBaseIds
  updateWorkspacePreferences({ pinnedKnowledgeBaseIds: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] })
}
