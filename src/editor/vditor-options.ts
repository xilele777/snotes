import { version } from 'vditor/package.json'

export const VDITOR_CDN = `/vendor/vditor/${version}`
const MODE_KEY = 'snotes_editor_mode'
export type EditorMode = 'ir' | 'wysiwyg' | 'sv'

export function editorMode(): EditorMode {
  try {
    const mode = localStorage.getItem(MODE_KEY)
    if (mode === 'ir' || mode === 'wysiwyg' || mode === 'sv') return mode
  } catch { /* Private browsing may disable localStorage. */ }
  return 'ir'
}

export function rememberEditorMode(mode: EditorMode) {
  try { localStorage.setItem(MODE_KEY, mode) } catch { /* Device preference only. */ }
}
