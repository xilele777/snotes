export const BRIDGE_VERSION = 1
export const MAX_MARKDOWN_CHARS = 2_000_000
export type Mode = 'source' | 'preview' | 'ir'
export interface DocumentLoad {
  bridgeVersion: 1; type: 'load'; profileId: string; noteId: string; sessionId: string
  markdown: string; readOnly: boolean; dark: boolean; fontSize: number
}
export class WebSession {
  document?: DocumentLoad
  revision = 0
  acknowledged = 0
  value = ''
  private normalized = ''
  private touched = false
  private lastComposing = false
  private undoValues: string[] = []
  private redoValues: string[] = []
  constructor(private readonly send: (message: object) => void) {}
  load(document: DocumentLoad) {
    this.document = document
    this.value = document.markdown
    this.normalized = document.markdown
    this.revision = this.acknowledged = 0
    this.touched = false
    this.lastComposing = false
    this.undoValues = []
    this.redoValues = []
  }
  observeBaseline(value: string) { this.normalized = value }
  capture(value: string, composing: boolean, userEdit = false) {
    if (!this.document || this.document.readOnly) return
    if (!this.touched && !userEdit) return
    if (value === this.normalized) {
      if (this.touched && composing !== this.lastComposing) {
        this.lastComposing = composing
        this.message('change', { revision: this.revision, markdown: this.value, composing })
      }
      return
    }
    this.touched = true
    this.lastComposing = composing
    this.undoValues.push(this.value)
    // Bound history memory for long documents without truncating the document itself.
    while (this.undoValues.length > 100 || this.undoValues.reduce((n, v) => n + v.length, 0) > 2_000_000) this.undoValues.shift()
    this.redoValues = []
    this.publish(value, composing)
  }
  history(redo: boolean): string | undefined {
    const from = redo ? this.redoValues : this.undoValues
    const value = from.pop()
    if (value === undefined) return
    ;(redo ? this.undoValues : this.redoValues).push(this.value)
    this.publish(value, false)
    return value
  }
  private publish(value: string, composing: boolean) {
    this.value = this.normalized = value
    this.revision++
    this.touched = true
    this.lastComposing = composing
    this.message('change', { revision: this.revision, markdown: value, composing })
  }
  message(type: string, fields: object = {}) {
    if (!this.document) return
    const { profileId, noteId, sessionId } = this.document
    this.send({ bridgeVersion: BRIDGE_VERSION, type, profileId, noteId, sessionId, ...fields })
  }
  saved(sessionId: string, revision: number): boolean {
    if (sessionId !== this.document?.sessionId || !Number.isSafeInteger(revision) || revision < 0 || revision > this.revision || revision < this.acknowledged) return false
    this.acknowledged = revision
    return revision === this.revision
  }
}

export function validLoad(value: unknown): value is DocumentLoad {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.bridgeVersion === 1 && v.type === 'load'
    && ['profileId', 'noteId', 'sessionId'].every(k => typeof v[k] === 'string' && (v[k] as string).length > 0 && (v[k] as string).length <= 128)
    && typeof v.markdown === 'string' && v.markdown.length <= MAX_MARKDOWN_CHARS
    && typeof v.readOnly === 'boolean' && typeof v.dark === 'boolean'
    && typeof v.fontSize === 'number' && v.fontSize >= 12 && v.fontSize <= 48
}
