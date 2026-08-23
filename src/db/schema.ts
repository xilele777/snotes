import Dexie, { type EntityTable } from 'dexie'
import type { Group, LocalNote, OutboxTask } from '../../shared/types'

export interface MetaRow {
  key: string
  value: unknown
}

export const db = new Dexie('snotes') as Dexie & {
  notes: EntityTable<LocalNote, 'id'>
  outbox: EntityTable<OutboxTask, 'id'>
  groups: EntityTable<Group, 'group_id'>
  meta: EntityTable<MetaRow, 'key'>
}

db.version(1).stores({
  notes: 'id, update_time, group_id, invalid, star, top, dirty',
  outbox: '++id, note_id, kind, next_at, failed, [note_id+kind]',
  groups: 'group_id, ord, invalid',
  meta: 'key',
})
