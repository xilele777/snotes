import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './schema'
import {
  HISTORY_CHAR_DELTA,
  HISTORY_KEEP,
  HISTORY_MAX_AGE_MS,
  HISTORY_MIN_INTERVAL_MS,
  deleteHistoryIn,
  listHistory,
  recordSnapshotIn,
  shouldSnapshot,
} from './history'
import { createNote, purgeNote, purgeTrash, restoreFromHistory, trashNote, updateBody } from './repo'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const long = (n: number) => 'x'.repeat(n)

describe('shouldSnapshot', () => {
  it('旧正文为空或与新正文相同时不存', () => {
    expect(shouldSnapshot('', 'a', undefined, 0)).toBe(false)
    expect(shouldSnapshot('   \n', 'a', undefined, 0)).toBe(false)
    expect(shouldSnapshot('a', 'a', undefined, 0)).toBe(false)
  })

  it('没有任何快照时存第一条；与上一条快照相同不重复', () => {
    expect(shouldSnapshot('a', 'b', undefined, 0)).toBe(true)
    expect(shouldSnapshot('a', 'b', { time: 0, body: 'a' }, HISTORY_MIN_INTERVAL_MS * 10)).toBe(false)
  })

  it('距上一条快照满 5 分钟就存，否则看字数变化是否达到阈值', () => {
    const last = { time: 1_000, body: 'ab' }
    expect(shouldSnapshot('abc', 'abcd', last, 1_000 + HISTORY_MIN_INTERVAL_MS)).toBe(true)
    expect(shouldSnapshot('abc', 'abcd', last, 1_000 + HISTORY_MIN_INTERVAL_MS - 1)).toBe(false)
    expect(shouldSnapshot(long(HISTORY_CHAR_DELTA + 2), 'z', last, 2_000)).toBe(true)
    expect(shouldSnapshot(long(HISTORY_CHAR_DELTA), 'z', last, 2_000)).toBe(false)
  })
})

describe('updateBody 留快照', () => {
  it('第一次改动存下旧正文，快照时间是旧正文的落库时刻；短时间内小改不再存', async () => {
    const note = await createNote('# 标题\n第一版')
    await updateBody(note.id, '# 标题\n第二版')
    let rows = await listHistory(note.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toBe('# 标题\n第一版')
    expect(rows[0].time).toBe(note.update_time)

    await updateBody(note.id, '# 标题\n第三版')
    rows = await listHistory(note.id)
    expect(rows).toHaveLength(1)
  })

  it('间隔超过 5 分钟再改，存第二条；最新的排在前面', async () => {
    const note = await createNote('第一版')
    await updateBody(note.id, '第二版')
    // 只推 Date.now：fake timers 会把 fake-indexeddb 依赖的 setTimeout 一起冻住，Dexie 事务永远不结束
    const later = Date.now() + HISTORY_MIN_INTERVAL_MS + 1
    vi.spyOn(Date, 'now').mockReturnValue(later)
    await updateBody(note.id, '第三版')
    vi.restoreAllMocks()
    const rows = await listHistory(note.id)
    expect(rows.map((r) => r.body)).toEqual(['第二版', '第一版'])
  })

  it('一次删掉大段文字立刻留快照，不等 5 分钟', async () => {
    const note = await createNote('第一版')
    await updateBody(note.id, long(HISTORY_CHAR_DELTA + 50))
    await updateBody(note.id, '误删后只剩这点')
    const rows = await listHistory(note.id)
    expect(rows.map((r) => r.body)).toEqual([long(HISTORY_CHAR_DELTA + 50), '第一版'])
  })

  it('每条笔记最多 20 条，超过 30 天的丢弃', async () => {
    const note = await createNote('v0')
    const base = Date.now()
    for (let i = 1; i <= HISTORY_KEEP + 5; i++) {
      await db.transaction('rw', db.history, () => recordSnapshotIn(note.id, `v${i}`, base + i))
    }
    let rows = await listHistory(note.id)
    expect(rows).toHaveLength(HISTORY_KEEP)
    expect(rows[0].body).toBe(`v${HISTORY_KEEP + 5}`)
    expect(rows.at(-1)!.body).toBe('v6')

    await db.transaction('rw', db.history, () => recordSnapshotIn(note.id, 'new', base + HISTORY_KEEP + 5 + HISTORY_MAX_AGE_MS + 1))
    rows = await listHistory(note.id)
    expect(rows.map((r) => r.body)).toEqual(['new'])
  })
})

describe('restoreFromHistory', () => {
  it('恢复前把当前正文存为快照，恢复后正文替换并入队推送', async () => {
    const note = await createNote('第一版')
    await updateBody(note.id, '第二版')
    const [snapshot] = await listHistory(note.id)
    expect(await restoreFromHistory(note.id, snapshot.id)).toBe(true)

    expect((await db.notes.get(note.id))!.body).toBe('第一版')
    const rows = await listHistory(note.id)
    expect(rows.map((r) => r.body)).toEqual(['第二版', '第一版'])
    const task = await db.outbox.where('[note_id+kind]').equals([note.id, 'body']).first()
    expect(task?.payload).toMatchObject({ content: '第一版' })
  })

  it('快照不属于这条笔记时拒绝', async () => {
    const a = await createNote('a1')
    const b = await createNote('b1')
    await updateBody(a.id, 'a2')
    const [snapshot] = await listHistory(a.id)
    expect(await restoreFromHistory(b.id, snapshot.id)).toBe(false)
    expect(await restoreFromHistory(a.id, 9999)).toBe(false)
    expect((await db.notes.get(b.id))!.body).toBe('b1')
  })
})

describe('物理删除连带清理', () => {
  it('purgeNote、purgeTrash 与 deleteHistoryIn 都会删掉对应历史', async () => {
    const a = await createNote('a1')
    const b = await createNote('b1')
    const c = await createNote('c1')
    for (const n of [a, b, c]) await updateBody(n.id, `${n.body}-2`)
    expect(await db.history.count()).toBe(3)

    await purgeNote(a.id)
    expect(await db.history.where('note_id').equals(a.id).count()).toBe(0)

    await trashNote(b.id)
    await purgeTrash()
    expect(await db.history.where('note_id').equals(b.id).count()).toBe(0)

    await db.transaction('rw', db.history, () => deleteHistoryIn([c.id]))
    expect(await db.history.count()).toBe(0)
  })
})
