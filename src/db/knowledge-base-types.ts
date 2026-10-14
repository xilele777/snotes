import type { KnowledgeBaseMeta, KnowledgeBaseRemote, TocNode } from '../../shared/knowledge-base'

export interface KnowledgeBaseSent {
  seq: number
  base_version: number
  operation_id: string
  payload: KnowledgeBaseMeta | TocNode[]
  preserve_missing_references?: boolean
  archived_meta_version?: number
}
export interface KnowledgeBaseTask extends KnowledgeBaseSent {
  id: string
  book_id: string
  kind: 'meta' | 'toc'
  retry: number
  next_at: number
  blocked: boolean
  error: string | null
  /** Persist before HTTP; edits made while a response is uncertain cannot change its retry. */
  sent?: KnowledgeBaseSent
  conflict?: KnowledgeBaseRemote
}
export interface KnowledgeBaseHistory {
  id: string
  book_id: string
  time: number
  source: 'confirmed' | 'conflict' | 'discarded'
  nodes: TocNode[]
  meta?: KnowledgeBaseMeta
}
export interface KnowledgeBaseNoteState {
  id: string
  state: 'available' | 'trash' | 'purged'
}
