import Dexie, { type EntityTable } from 'dexie'
import type { Group, LocalBody, LocalNote, OutboxTask } from '../../shared/types'
import type { KnowledgeBase, KnowledgeBaseToc } from '../../shared/knowledge-base'
import type { KnowledgeBaseTask, KnowledgeBaseHistory, KnowledgeBaseNoteState } from './knowledge-base-types'

export interface MetaRow {
  key: string
  value: unknown
}

/** 本地正文历史的一条快照：纯本地，不同步；格式 3 备份包含。 */
export interface HistoryRow {
  id?: number
  note_id: string
  /** 快照时间（被替换的那一版正文最后一次落库的时刻） */
  time: number
  body: string
}

export const db = new Dexie('snotes') as Dexie & {
  notes: EntityTable<LocalNote, 'id'>
  bodies: EntityTable<LocalBody, 'id'>
  outbox: EntityTable<OutboxTask, 'id'>
  groups: EntityTable<Group, 'group_id'>
  meta: EntityTable<MetaRow, 'key'>
  history: EntityTable<HistoryRow, 'id'>
  knowledgeBases: EntityTable<KnowledgeBase, 'id'>
  knowledgeBaseTocs: EntityTable<KnowledgeBaseToc, 'knowledge_base_id'>
  knowledgeBaseOutbox: EntityTable<KnowledgeBaseTask, 'id'>
  knowledgeBaseTocHistory: EntityTable<KnowledgeBaseHistory, 'id'>
  knowledgeBaseNoteStates: EntityTable<KnowledgeBaseNoteState, 'id'>
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

db.version(3).stores({
  knowledgeBases: 'id, ord, invalid',
  knowledgeBaseTocs: 'knowledge_base_id',
  knowledgeBaseOutbox: 'id, book_id, next_at',
  knowledgeBaseTocHistory: 'id, book_id, time',
  knowledgeBaseNoteStates: 'id',
})

// v4：正文从 notes 行拆到独立的 bodies 表（同主键）。
// 列表、搜索、同步元数据都要遍历 notes 全表，行内内联几 KB 正文让每次 load
// 都把全部正文反序列化一遍——笔记越多越卡。拆表后列表只读小元数据，正文
// 打开笔记时按主键取一条（与 WPS 便签「列表只含密文元数据、正文按需拉取」同构）。
db.version(4)
  .stores({
    notes: 'id, update_time, group_id, invalid, star, top, dirty',
    bodies: 'id',
    outbox: '++id, note_id, kind, next_at, failed, [note_id+kind]',
    groups: 'group_id, ord, invalid',
    meta: 'key',
    history: '++id, note_id, time',
    knowledgeBases: 'id, ord, invalid',
    knowledgeBaseTocs: 'knowledge_base_id',
    knowledgeBaseOutbox: 'id, book_id, next_at',
    knowledgeBaseTocHistory: 'id, book_id, time',
    knowledgeBaseNoteStates: 'id',
  })
  .upgrade(async (tx) => {
    // 分块搬运：notes 每行重写一次（去掉 body）、bodies 写入一次。
    // 逐行 modify 是读改写两次 IO，2000 条就要数秒；bulkGet/bulkPut 按批走快一个量级，
    // 同时避免全表常驻内存（低端机上有几万条笔记也不能爆）。
    const CHUNK = 500
    const notes = tx.table('notes')
    const keys: string[] = await notes.toCollection().primaryKeys()
    for (let offset = 0; offset < keys.length; offset += CHUNK) {
      const rows: (LocalNote & { body?: string })[] = await notes.bulkGet(keys.slice(offset, offset + CHUNK))
      const bodies = rows
        .filter((row) => typeof row.body === 'string')
        .map((row) => ({ id: row.id, body: row.body as string }))
      if (bodies.length) await tx.table('bodies').bulkPut(bodies)
      await notes.bulkPut(rows.map((row) => {
        const { body: _dropped, ...rest } = row
        return rest
      }))
    }
  })
