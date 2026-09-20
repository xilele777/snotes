import Dexie, { type EntityTable } from 'dexie'
import type { Group, LocalNote, OutboxTask } from '../../shared/types'

export interface MetaRow {
  key: string
  value: unknown
}

/** 本地正文历史的一条快照：纯本地，不同步、不导出。 */
export interface HistoryRow {
  id?: number
  note_id: string
  /** 快照时间（被替换的那一版正文最后一次落库的时刻） */
  time: number
  body: string
}

export const db = new Dexie('snotes') as Dexie & {
  notes: EntityTable<LocalNote, 'id'>
  outbox: EntityTable<OutboxTask, 'id'>
  groups: EntityTable<Group, 'group_id'>
  meta: EntityTable<MetaRow, 'key'>
  history: EntityTable<HistoryRow, 'id'>
}

db.version(1).stores({
  notes: 'id, update_time, group_id, invalid, star, top, dirty',
  outbox: '++id, note_id, kind, next_at, failed, [note_id+kind]',
  groups: 'group_id, ord, invalid',
  meta: 'key',
})

// v2：本地正文历史。只加表，旧表结构不变，Dexie 自动沿用。
db.version(2).stores({
  notes: 'id, update_time, group_id, invalid, star, top, dirty',
  outbox: '++id, note_id, kind, next_at, failed, [note_id+kind]',
  groups: 'group_id, ord, invalid',
  meta: 'key',
  history: '++id, note_id, time',
})
