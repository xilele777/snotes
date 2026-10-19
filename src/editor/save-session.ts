import { ref } from 'vue'

export interface UnsavedDraft {
  id: string
  journalKey: string
  body: string
  base: string
  updatedAt: number
  error?: string
}

const PREFIX = 'snotes_unsaved_draft:'
function read(): UnsavedDraft[] {
  const drafts: UnsavedDraft[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      try {
        const draft = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (draft && typeof draft.id === 'string' && typeof draft.body === 'string'
          && typeof draft.base === 'string' && Number.isFinite(draft.updatedAt)) drafts.push({ ...draft, journalKey: key })
      } catch { /* One damaged record must not hide the other recovery entries. */ }
    }
  } catch { /* Storage may be unavailable in private browsing. */ }
  return drafts
}

// Separate session keys prevent a successful save in one tab from deleting
// another tab's failed draft, even when both edit the same note.
export const unsavedDrafts = ref<UnsavedDraft[]>(read())
const owned = new Map<string, string>()
const running = new Map<string, Promise<void>>()
const noteQueues = new Map<string, Promise<void>>()

function persist(entry: UnsavedDraft) {
  try { localStorage.setItem(entry.journalKey, JSON.stringify(entry)) }
  catch { /* Keep the in-memory draft/recovery UI even if both stores are full. */ }
}

function find(selector: string) {
  return unsavedDrafts.value.find(d => d.journalKey === selector)
    ?? unsavedDrafts.value.find(d => d.journalKey === owned.get(selector))
    ?? unsavedDrafts.value.find(d => d.id === selector)
}

export function stageDraft(id: string, body: string, base: string) {
  const existing = unsavedDrafts.value.find(d => d.journalKey === owned.get(id))
  if (existing) {
    existing.body = body
    existing.updatedAt = Date.now()
    persist(existing)
  } else {
    const entry = { id, body, base, updatedAt: Date.now(), journalKey: PREFIX + crypto.randomUUID() }
    owned.set(id, entry.journalKey)
    unsavedDrafts.value.push(entry)
    persist(entry)
  }
}

export function discardDraft(selector: string) {
  const entry = find(selector)
  if (!entry) return
  unsavedDrafts.value = unsavedDrafts.value.filter(d => d.journalKey !== entry.journalKey)
  if (owned.get(entry.id) === entry.journalKey) owned.delete(entry.id)
  try { localStorage.removeItem(entry.journalKey) } catch { /* A stale entry remains recoverable after reload. */ }
}

export async function waitForDraftSaves(): Promise<boolean> {
  await Promise.allSettled([...running.values()])
  return unsavedDrafts.value.length === 0
}

export function saveDraft(selector: string, save: (id: string, body: string, base: string) => Promise<unknown>): Promise<void> {
  const entry = find(selector)
  if (!entry) return Promise.resolve()
  const pending = running.get(entry.journalKey)
  if (pending) return pending
  const previous = noteQueues.get(entry.id)
  const operation = (async () => {
    // Recovery of an older session and current typing share the same note queue.
    if (previous) await previous.catch(() => undefined)
    for (;;) {
      if (!unsavedDrafts.value.some(d => d.journalKey === entry.journalKey)) return
      const snapshot = { ...entry }
      try { await save(entry.id, snapshot.body, snapshot.base) }
      catch (error) {
        entry.error = error instanceof Error ? error.message : String(error)
        persist(entry)
        throw error
      }
      if (entry.body === snapshot.body) { discardDraft(entry.journalKey); return }
      entry.base = snapshot.body
      delete entry.error
      persist(entry)
    }
  })().finally(() => {
    running.delete(entry.journalKey)
    if (noteQueues.get(entry.id) === operation) noteQueues.delete(entry.id)
  })
  running.set(entry.journalKey, operation)
  noteQueues.set(entry.id, operation)
  return operation
}
