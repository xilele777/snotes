import { beforeEach, describe, expect, it } from 'vitest'
import { createNote } from '../db/repo'
import { db } from '../db/schema'
import { CONFLICT_SUFFIX, saveConflictCopies } from './conflict'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('saveConflictCopies', () => {
  it('为每个冲突生成一条新笔记', async () => {
    const note = await createNote('原始内容')

    const ids = await saveConflictCopies([{ note_id: note.id, local_body: '我的本地内容' }])

    expect(ids).toHaveLength(1)
    const copy = await db.notes.get(ids[0])
    expect(copy!.body).toContain('我的本地内容')
  })

  it('副本标题带冲突后缀', async () => {
    const note = await createNote('# 会议纪要\n内容')

    const ids = await saveConflictCopies([{ note_id: note.id, local_body: '# 会议纪要\n我的版本' }])

    const copy = await db.notes.get(ids[0])
    expect(copy!.title).toContain(CONFLICT_SUFFIX)
    expect(copy!.title).toContain('会议纪要')
  })

  it('副本是独立笔记，原笔记不受影响', async () => {
    const note = await createNote('原始内容')

    const ids = await saveConflictCopies([{ note_id: note.id, local_body: '本地内容' }])

    expect(ids[0]).not.toBe(note.id)
    expect((await db.notes.get(note.id))!.body).toBe('原始内容')
  })

  it('副本继承原笔记的分组，便于就地找到', async () => {
    const note = await createNote('内容')
    await db.notes.update(note.id, { group_id: 'g1' })

    const ids = await saveConflictCopies([{ note_id: note.id, local_body: '本地' }])

    expect((await db.notes.get(ids[0]))!.group_id).toBe('g1')
  })

  it('副本入队等待推送，不会只存在于本地', async () => {
    const note = await createNote('内容')
    await db.outbox.clear()

    const ids = await saveConflictCopies([{ note_id: note.id, local_body: '本地' }])

    const tasks = await db.outbox.where('note_id').equals(ids[0]).toArray()
    expect(tasks.some((t) => t.kind === 'create')).toBe(true)
  })

  it('原笔记不存在时跳过，不抛异常', async () => {
    const ids = await saveConflictCopies([{ note_id: '不存在', local_body: '内容' }])
    expect(ids).toEqual([])
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
      { note_id: a.id, local_body: 'a 本地' },
      { note_id: b.id, local_body: 'b 本地' },
    ])

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('超长标题下后缀不会被截断吞掉', async () => {
    const note = await createNote('内容')
    const longTitle = '标'.repeat(80)

    const ids = await saveConflictCopies([{ note_id: note.id, local_body: `# ${longTitle}` }])

    // 后缀被 TITLE_MAX 截掉的话，用户就完全看不出这是冲突副本了
    const copy = await db.notes.get(ids[0])
    expect(copy!.title.endsWith(CONFLICT_SUFFIX)).toBe(true)
    expect(copy!.title.length).toBeLessThanOrEqual(64)
  })

  it('副本的分组变更进了 outbox，会同步到其他设备', async () => {
    const note = await createNote('内容')
    await db.notes.update(note.id, { group_id: 'g1' })
    await db.outbox.clear()

    const ids = await saveConflictCopies([{ note_id: note.id, local_body: '本地' }])

    // 直接写 db.notes 不入队的话，副本在别的设备上会掉出分组
    const task = await db.outbox
      .where('[note_id+kind]')
      .equals([ids[0], 'prop'])
      .first()
    expect(task!.payload).toMatchObject({ group_id: 'g1' })
  })
})
