/** Personal libraries reference notes; their structure has its own sync version. */
export interface KnowledgeBase {
  id: string
  name: string
  description: string
  icon: string
  ord: number
  invalid: 0 | 1
  meta_version: number
  toc_version: number
  create_time: number
  update_time: number
  change_seq: number
}

export interface TocNode {
  id: string
  parent_id: string | null
  kind: 'folder' | 'note'
  ord: number
  note_id: string | null
  title: string | null
}

export interface KnowledgeBaseToc {
  knowledge_base_id: string
  version: number
  nodes: TocNode[]
  update_time: number
}

export type KnowledgeBaseMeta = Pick<KnowledgeBase, 'name' | 'description' | 'icon' | 'ord' | 'invalid'>
export interface KnowledgeBaseAck {
  meta_version: number
  toc_version: number
  update_time: number
}
export interface KnowledgeBaseRemote {
  book: KnowledgeBase
  toc: KnowledgeBaseToc
  note_states: Record<string, 'available' | 'trash' | 'purged'>
}

export const MAX_TOC_NODES = 1000
export const MAX_TOC_DEPTH = 8
export const MAX_TOC_BYTES = 1024 * 1024
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
}

export function validateKnowledgeBaseMeta(value: unknown): KnowledgeBaseMeta {
  if (!value || typeof value !== 'object') throw new Error('知识库信息不完整')
  const m = value as KnowledgeBaseMeta
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100
    || typeof m.description !== 'string' || m.description.length > 2000
    || typeof m.icon !== 'string' || m.icon.length > 32
    || !Number.isSafeInteger(m.ord) || Math.abs(m.ord) > 1_000_000
    || (m.invalid !== 0 && m.invalid !== 1)) throw new Error('知识库名称或简介不符合要求')
  return { name: m.name.trim(), description: m.description, icon: m.icon, ord: m.ord, invalid: m.invalid }
}

/** Validate before writing either IndexedDB or the API. Never trust cached tree data. */
export function validateToc(value: unknown): TocNode[] {
  if (!Array.isArray(value) || value.length > MAX_TOC_NODES) throw new Error('每个知识库最多 1000 个目录节点')
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_TOC_BYTES) throw new Error('目录超过 1 MiB')
  const ids = new Set<string>()
  const notes = new Set<string>()
  const nodes: TocNode[] = value.map((raw: TocNode) => {
    if (!raw || !validId(raw.id) || ids.has(raw.id)
      || (raw.parent_id !== null && !validId(raw.parent_id))
      || !Number.isSafeInteger(raw.ord) || raw.ord < 0 || raw.ord > MAX_TOC_NODES) throw new Error('目录节点或排序无效')
    ids.add(raw.id)
    if (raw.kind === 'folder') {
      if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 100 || raw.note_id !== null) throw new Error('章节名称无效')
    } else if (raw.kind === 'note') {
      if (!validId(raw.note_id) || notes.has(raw.note_id) || raw.title !== null) throw new Error('同一知识库不能重复引用笔记')
      notes.add(raw.note_id)
    } else throw new Error('不支持的目录节点类型')
    return { id: raw.id, parent_id: raw.parent_id, kind: raw.kind, ord: raw.ord, note_id: raw.note_id, title: raw.title }
  })
  const byId = new Map(nodes.map(n => [n.id, n]))
  for (const node of nodes) {
    let parent = node.parent_id
    const ancestors = new Set([node.id])
    let depth = 1
    while (parent !== null) {
      const p = byId.get(parent)
      if (!p || p.kind !== 'folder' || ancestors.has(parent)) throw new Error('章节不能移动到自身或子章节中')
      ancestors.add(parent)
      parent = p.parent_id
      if (++depth > MAX_TOC_DEPTH) throw new Error('目录最多支持 8 层')
    }
  }
  return nodes
}

export function childrenOf(nodes: TocNode[], parent: string | null): TocNode[] {
  return nodes.filter(n => n.parent_id === parent).sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
}

export function descendantsOf(nodes: TocNode[], id: string): Set<string> {
  const result = new Set([id])
  for (let changed = true; changed;) {
    changed = false
    for (const n of nodes) if (n.parent_id && result.has(n.parent_id) && !result.has(n.id)) { result.add(n.id); changed = true }
  }
  return result
}

/** Move the whole subtree; position is the insertion index amongst the target's siblings. */
export function moveTocNode(nodes: TocNode[], id: string, parent: string | null, position: number): TocNode[] {
  const result = nodes.map(n => ({ ...n }))
  const target = result.find(n => n.id === id)
  if (!target) throw new Error('目录节点不存在')
  if (parent && descendantsOf(nodes, id).has(parent)) throw new Error('章节不能移动到自身或子章节中')
  const oldParent = target.parent_id
  target.parent_id = parent
  const siblings = childrenOf(result.filter(n => n.id !== id), parent)
  siblings.splice(Math.max(0, Math.min(position, siblings.length)), 0, target)
  siblings.forEach((n, i) => { n.ord = i })
  if (oldParent !== parent) childrenOf(result, oldParent).forEach((n, i) => { n.ord = i })
  return validateToc(result)
}

export function flattenToc(nodes: TocNode[]): { node: TocNode; depth: number; path: string[] }[] {
  const rows: { node: TocNode; depth: number; path: string[] }[] = []
  const visit = (parent: string | null, path: string[]) => {
    for (const node of childrenOf(nodes, parent)) {
      rows.push({ node, depth: path.length, path })
      if (node.kind === 'folder') visit(node.id, [...path, node.title!])
    }
  }
  visit(null, [])
  return rows
}
