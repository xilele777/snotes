import type { Group, LocalNote } from '../shared/types'
import type { KnowledgeBase, KnowledgeBaseToc } from '../shared/knowledge-base'
import { matchesAll, splitTerms } from './components/SearchBar'

export interface SearchDestination {
  kind: 'note' | 'book'
  id: string
  title: string
  context: string
  preview: string
  bookId: string | null
  updated: number
}

/** Search every active local note, including notebook contents, without surfacing removed notebooks. */
export function searchWorkspace(notes: LocalNote[], books: KnowledgeBase[], tocs: KnowledgeBaseToc[], groups: Group[], query: string): SearchDestination[] {
  const activeBooks = new Map(books.filter(book => !book.invalid && !book.deleted).map(book => [book.id, book]))
  const groupNames = new Map(groups.filter(group => !group.invalid).map(group => [group.group_id, group.name]))
  const attached = new Set<string>()
  const owners = new Map<string, string>()
  for (const toc of tocs) for (const node of toc.nodes) {
    if (!node.note_id) continue
    attached.add(node.note_id)
    if (activeBooks.has(toc.knowledge_base_id) && !owners.has(node.note_id)) owners.set(node.note_id, toc.knowledge_base_id)
  }
  const terms = splitTerms(query)
  const results: (SearchDestination & { rank: number })[] = []
  for (const book of activeBooks.values()) {
    if (!matchesAll(`${book.name}\n${book.description}`, terms)) continue
    results.push({ kind: 'book', id: book.id, title: book.name, context: '笔记本', preview: book.description, bookId: book.id, updated: book.update_time, rank: matchesAll(book.name, terms) ? 0 : 1 })
  }
  for (const note of notes) {
    if (note.invalid || attached.has(note.id) && !owners.has(note.id)) continue
    const bookId = owners.get(note.id) ?? null
    const context = bookId ? activeBooks.get(bookId)!.name : groupNames.get(note.group_id ?? '') ?? '独立笔记'
    if (!matchesAll(`${note.title}\n${context}\n${note.summary}\n${note.body}`, terms)) continue
    results.push({ kind: 'note', id: note.id, title: note.title || '无标题', context, preview: note.summary, bookId, updated: note.update_time, rank: matchesAll(note.title, terms) ? 0 : matchesAll(context, terms) ? 1 : 2 })
  }
  return results.sort((a, b) => a.rank - b.rank || b.updated - a.updated || a.id.localeCompare(b.id))
}
