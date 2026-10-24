import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { db } from './schema'

/**
 * v3 → v4 迁移：notes 行内联的 body 拆到 bodies 表。
 * 用旧版 schema 建库种数据，再用真实 schema 打开，验证升级不丢正文、不丢任务，
 * 并把迁移耗时打到输出（几千条规模应仍是亚秒级，属一次性成本）。
 */

const LEGACY_SCHEMA = {
  notes: 'id, update_time, group_id, invalid, star, top, dirty',
  outbox: '++id, note_id, kind, next_at, failed, [note_id+kind]',
  groups: 'group_id, ord, invalid',
  meta: 'key',
  history: '++id, note_id, time',
  knowledgeBases: 'id, ord, invalid',
  knowledgeBaseTocs: 'knowledge_base_id',
  knowledgeBaseOutbox: 'id, book_id, next_at',
  knowledgeBaseTocHistory: 'id, book_id, time',
  knowledgeBaseNoteStates: 'id',
}

const bodyOf = (id: string) => `# ${id}\n\n${'这是一段正常的中文笔记正文。'.repeat(40)}`

describe('schema v3 → v4 迁移', () => {
  it('行内正文搬进 bodies 表，notes 行不再带 body，outbox/meta 原样保留', { timeout: 60_000 }, async () => {
    await db.delete()

    const legacy = new Dexie('snotes')
    legacy.version(1).stores(LEGACY_SCHEMA)
    legacy.version(2).stores({ ...LEGACY_SCHEMA, history: '++id, note_id, time' })
    legacy.version(3).stores({
      ...LEGACY_SCHEMA,
      knowledgeBases: 'id, ord, invalid',
      knowledgeBaseTocs: 'knowledge_base_id',
      knowledgeBaseOutbox: 'id, book_id, next_at',
      knowledgeBaseTocHistory: 'id, book_id, time',
      knowledgeBaseNoteStates: 'id',
    })
    await legacy.open()
    const COUNT = 2000
    const notes = Array.from({ length: COUNT }, (_, i) => ({
      id: `m${String(i).padStart(4, '0')}`, group_id: null, title: `t${i}`, summary: '', thumbnail: null,
      version: 1, prop_version: 1, star: 0, top: 0, skin_color: null, invalid: 0 as const,
      create_time: i, update_time: i, body: bodyOf(`m${String(i).padStart(4, '0')}`),
      body_version: 1, dirty: 'none' as const,
    }))
    await legacy.table('notes').bulkAdd(notes)
    await legacy.table('outbox').bulkAdd([
      { note_id: 'm0000', kind: 'prop', payload: {}, retry: 0, next_at: 0, seq: 1, failed: 0 },
    ])
    await legacy.table('meta').bulkPut([{ key: 'sync_cursor', value: 42 }])
    legacy.close()

    const started = performance.now()
    await db.open()
    const elapsedMs = Math.round(performance.now() - started)
    console.log(`[migration] v3→v4 迁移 ${COUNT} 条笔记耗时 ${elapsedMs}ms`)

    const sample = await db.notes.get('m0000')
    expect(sample).toBeDefined()
    expect(sample && 'body' in sample).toBe(false)
    expect(await db.bodies.get('m0000')).toMatchObject({ body: bodyOf('m0000') })
    expect(await db.bodies.count()).toBe(COUNT)
    expect(await db.notes.count()).toBe(COUNT)
    expect(await db.outbox.where('note_id').equals('m0000').count()).toBe(1)
    expect(await db.meta.get('sync_cursor')).toMatchObject({ value: 42 })
    // 换一条再抽查一次，避免只有首条被搬走的巧合
    expect((await db.bodies.get('m1999'))!.body).toContain('m1999')

    await db.delete()
  })
})
