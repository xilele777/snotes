import { beforeEach, describe, expect, it } from 'vitest'
import { createNote } from '../db/repo'
import { db } from '../db/schema'
import { CONFLICT_SUFFIX, saveConflictCopies } from './conflict'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('saveConflictCopies', () => {
  it('为每个冲突生成一条新笔记，正文是被覆盖的那一版', async () => {
    const note = await createNote('本地内容')

    const ids = await saveConflictCopies([{ note_id: note.id, body: '被覆盖的远端内容' }])

    expect(ids).toHaveLength(1)
    const copy = await db.notes.get(ids[0])
    expect(copy!.body).toContain('被覆盖的远端内容')
  })

  it('副本标题带冲突后缀', async () => {
    const note = await createNote('# 会议纪要\n内容')

    const ids = await saveConflictCopies([{ note_id: note.id, body: '# 会议纪要\n另一台设备的版本' }])

    const copy = await db.notes.get(ids[0])
    expect(copy!.title).toContain(CONFLICT_SUFFIX)
    expect(copy!.title).toContain('会议纪要')
  })

  it('副本是独立笔记，原笔记不受影响', async () => {
    const note = await createNote('本地内容')

    const ids = await saveConflictCopies([{ note_id: note.id, body: '远端内容' }])

    expect(ids[0]).not.toBe(note.id)
    expect((await db.notes.get(note.id))!.body).toBe('本地内容')
  })

  it('副本继承原笔记的分组，便于就地找到', async () => {
    const note = await createNote('内容')
    await db.notes.update(note.id, { group_id: 'g1' })

    const ids = await saveConflictCopies([{ note_id: note.id, body: '远端' }])

    expect((await db.notes.get(ids[0]))!.group_id).toBe('g1')
  })

  it('副本入队等待推送，不会只存在于本地', async () => {
    const note = await createNote('内容')
    await db.outbox.clear()

    const ids = await saveConflictCopies([{ note_id: note.id, body: '远端' }])

    const tasks = await db.outbox.where('note_id').equals(ids[0]).toArray()
    expect(tasks.some((t) => t.kind === 'create')).toBe(true)
  })

  it('原笔记已不在本地时仍然保存副本——被覆盖的文字只剩这一份', async () => {
    const ids = await saveConflictCopies([{ note_id: '本地已删', body: '远端内容' }])

    expect(ids).toHaveLength(1)
    const copy = await db.notes.get(ids[0])
    expect(copy!.body).toContain('远端内容')
    expect(copy!.group_id).toBeNull()
  })

  it('空列表返回空数组且不写库', async () => {
    const before = await db.notes.count()
    const ids = await saveConflictCopies([])

    expect(ids).toEqual([])
    expect(await db.notes.count()).toBe(before)
  })

  it('多个冲突各生成一条副本', async () => {
    const a = await createNote('a')
    const b = await createNote('b')

    const ids = await saveConflictCopies([
      { note_id: a.id, body: 'a 远端' },
      { note_id: b.id, body: 'b 远端' },
    ])

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('超长标题下后缀不会被截断吞掉', async () => {
    const note = await createNote('内容')
    const longTitle = '标'.repeat(80)

    const ids = await saveConflictCopies([{ note_id: note.id, body: `# ${longTitle}` }])

    // 后缀被 TITLE_MAX 截掉的话，用户就完全看不出这是冲突副本了
    const copy = await db.notes.get(ids[0])
    expect(copy!.title.endsWith(CONFLICT_SUFFIX)).toBe(true)
    expect(copy!.title.length).toBeLessThanOrEqual(64)
  })

  it('副本的分组随 create 任务一起推送，其他设备上不会掉出分组', async () => {
    const note = await createNote('内容')
    await db.notes.update(note.id, { group_id: 'g1' })
    await db.outbox.clear()

    const ids = await saveConflictCopies([{ note_id: note.id, body: '远端' }])

    const task = await db.outbox
      .where('[note_id+kind]')
      .equals([ids[0], 'create'])
      .first()
    expect(task!.payload).toMatchObject({ group_id: 'g1' })
  })
})
