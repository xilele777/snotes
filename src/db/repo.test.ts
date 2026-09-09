import { beforeEach, describe, expect, it } from 'vitest'
import type { OutboxTask } from '../../shared/types'
import { db } from './schema'
import {
  CONFLICT_SUFFIX,
  createConflictCopy,
  createNote,
  enqueue,
  getMeta,
  getNote,
  listNotes,
  openNote,
  purgeNote,
  purgeTrash,
  recoverNote,
  setMeta,
  trashNote,
  updateBody,
  updateProps,
} from './repo'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('createNote', () => {
  it('立即返回一条带 id 与派生字段的笔记', async () => {
    const note = await createNote('# 我的标题\n正文内容')

    expect(note.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(note.title).toBe('我的标题')
    expect(note.summary).toBe('正文内容')
    expect(note.body).toBe('# 我的标题\n正文内容')
    // 0 = 服务端尚未确认任何版本，不是 1
    expect(note.version).toBe(0)
    expect(note.body_version).toBe(0)
    expect(note.dirty).toBe('both')
  })

  it('create_time 由客户端生成，离线也立刻有值', async () => {
    const before = Date.now()
    const note = await createNote('x')
    expect(note.create_time).toBeGreaterThanOrEqual(before)
  })

  it('写入 IndexedDB 且可立即读回', async () => {
    const note = await createNote('内容')
    expect(await getNote(note.id)).toMatchObject({ id: note.id, body: '内容' })
  })

  it('入队一条 create 任务', async () => {
    const note = await createNote('内容')
    const tasks = await db.outbox.toArray()

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ note_id: note.id, kind: 'create' })
  })
})

describe('updateBody', () => {
  it('更新正文并重算派生字段', async () => {
    const note = await createNote('旧标题')
    await updateBody(note.id, '# 新标题\n新正文')

    const updated = await getNote(note.id)
    expect(updated).toMatchObject({ title: '新标题', body: '# 新标题\n新正文' })
  })

  it('置 dirty 但不动 body_version', async () => {
    const note = await createNote('a')
    await updateBody(note.id, 'b')

    const updated = await getNote(note.id)
    // body_version 记的是「本地正文对应哪个服务端版本」，本地编辑不产生版本号
    expect(updated!.body_version).toBe(note.body_version)
    expect(updated!.dirty === 'body' || updated!.dirty === 'both').toBe(true)
  })

  it('入队的 body 任务带着服务端确认过的 base_version', async () => {
    const note = await createNote('a')
    await db.notes.update(note.id, { version: 7, body_version: 7 })
    await updateBody(note.id, 'b')

    const task = await db.outbox.where('kind').equals('body').first()
    expect((task!.payload as { base_version: number }).base_version).toBe(7)
  })

  it('连续编辑只在 outbox 留下一条 body 任务', async () => {
    const note = await createNote('a')
    await updateBody(note.id, 'b')
    await updateBody(note.id, 'c')
    await updateBody(note.id, 'd')

    const bodyTasks = await db.outbox.where('kind').equals('body').toArray()
    expect(bodyTasks).toHaveLength(1)
    expect((bodyTasks[0].payload as { content: string }).content).toBe('d')
  })

  it('对已物理删除的笔记 updateBody 不重建本地行、也不入队', async () => {
    const note = await createNote('a')
    await purgeNote(note.id)
    expect(await db.notes.get(note.id)).toBeUndefined()

    // 旧编辑器里仍指向这条被删笔记的输入，不应把行或 outbox 任务复活
    await updateBody(note.id, 'b')

    const remaining = await db.outbox.toArray()
    expect(remaining).toHaveLength(1) // 只剩那条 purge 任务
    expect(remaining[0].kind).toBe('purge')
    expect(await db.notes.get(note.id)).toBeUndefined()
  })
})

describe('updateProps', () => {
  it('只改属性不动正文', async () => {
    const note = await createNote('正文')
    await updateProps(note.id, { star: 1 })

    const updated = await getNote(note.id)
    expect(updated).toMatchObject({ star: 1, body: '正文' })
    expect(updated!.body_version).toBe(note.body_version)
  })

  it('属性任务与正文任务分别入队，互不覆盖', async () => {
    const note = await createNote('a')
    await updateBody(note.id, 'b')
    await updateProps(note.id, { top: 1 })

    const kinds = (await db.outbox.toArray()).map((t) => t.kind).sort()
    expect(kinds).toEqual(['body', 'create', 'prop'])
  })

  it('多次改属性合并为一条任务且保留最新值', async () => {
    const note = await createNote('a')
    await updateProps(note.id, { star: 1 })
    await updateProps(note.id, { top: 1 })

    const propTasks = await db.outbox.where('kind').equals('prop').toArray()
    expect(propTasks).toHaveLength(1)
    expect(propTasks[0].payload).toMatchObject({ top: 1 })
  })
})

describe('trashNote / recoverNote', () => {
  it('trash 置 invalid=1 并入队', async () => {
    const note = await createNote('a')
    await trashNote(note.id)

    expect((await getNote(note.id))!.invalid).toBe(1)
    const kinds = (await db.outbox.toArray()).map((t) => t.kind)
    expect(kinds).toContain('trash')
  })

  it('recover 置回 0', async () => {
    const note = await createNote('a')
    await trashNote(note.id)
    await recoverNote(note.id)

    expect((await getNote(note.id))!.invalid).toBe(0)
  })
})

describe('listNotes', () => {
  it('默认只返回未删除的笔记', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    await trashNote(b.id)

    const list = await listNotes({ view: 'all' })
    expect(list.map((n) => n.id)).toEqual([a.id])
  })

  it('回收站视图只返回已删除的', async () => {
    // 多建一条未删除的笔记，确保它不会混进回收站视图
    await createNote('a')
    const b = await createNote('b')
    await trashNote(b.id)

    const list = await listNotes({ view: 'trash' })
    expect(list.map((n) => n.id)).toEqual([b.id])
  })

  it('置顶的排在前面，其余按更新时间倒序', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    const c = await createNote('c')
    // 三条笔记很可能落在同一毫秒，必须显式拉开 update_time，
    // 否则断言实际是在考察 Dexie 的返回顺序，会随机失败
    await db.notes.update(a.id, { update_time: 1000 })
    await db.notes.update(b.id, { update_time: 2000 })
    await db.notes.update(c.id, { update_time: 3000, top: 1 })

    const list = await listNotes({ view: 'all' })
    expect(list.map((n) => n.id)).toEqual([c.id, b.id, a.id])
  })

  it('update_time 相同时按 id 排序，保证顺序确定', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    await db.notes.update(a.id, { update_time: 1000 })
    await db.notes.update(b.id, { update_time: 1000 })

    const expected = [a.id, b.id].sort()
    const list = await listNotes({ view: 'all' })
    expect(list.map((n) => n.id)).toEqual(expected)
  })

  it('可按分组过滤', async () => {
    const a = await createNote('a')
    await createNote('b')
    await updateProps(a.id, { group_id: 'g1' })

    const list = await listNotes({ view: 'group', groupId: 'g1' })
    expect(list.map((n) => n.id)).toEqual([a.id])
  })

  it('星标视图只返回 star=1', async () => {
    const a = await createNote('a')
    await createNote('b')
    await updateProps(a.id, { star: 1 })

    const list = await listNotes({ view: 'star' })
    expect(list.map((n) => n.id)).toEqual([a.id])
  })
})

describe('openNote', () => {
  it('递增 open_count、刷新 last_open_time，不动 update_time', async () => {
    const note = await createNote('a')
    const before = (await getNote(note.id))!
    const beforeUpdate = before.update_time

    await openNote(note.id)
    await openNote(note.id)

    const after = (await getNote(note.id))!
    expect(after.open_count).toBe(2)
    expect(after.last_open_time).toBeGreaterThan(beforeUpdate)
    // 打开笔记不应改动 update_time，否则会把点开的笔记顶到列表最新
    expect(after.update_time).toBe(beforeUpdate)
  })

  it('不写入 outbox，不进同步流程', async () => {
    const note = await createNote('a')
    await db.outbox.clear()
    await openNote(note.id)
    expect(await db.outbox.count()).toBe(0)
  })

  it('旧笔记缺失字段时按 0 兜底再 +1', async () => {
    const note = await createNote('a')
    // 模拟升级前创建的旧笔记：直接抹掉本地统计字段
    await db.notes.update(note.id, { open_count: undefined as unknown as number, last_open_time: undefined as unknown as number })

    await openNote(note.id)
    const after = (await getNote(note.id))!
    expect(after.open_count).toBe(1)
    expect(after.last_open_time).toBeGreaterThan(0)
  })

  it('不存在的 id 静默返回', async () => {
    await expect(openNote('不存在')).resolves.toBeUndefined()
  })
})

describe('meta', () => {
  it('读写单例配置', async () => {
    expect(await getMeta<number>('sync_cursor')).toBeUndefined()
    await setMeta('sync_cursor', 12345)
    expect(await getMeta<number>('sync_cursor')).toBe(12345)
  })
})

describe('enqueue', () => {
  const task = (over: Partial<OutboxTask>): OutboxTask => ({
    note_id: 'a',
    kind: 'prop',
    payload: { star: 1 },
    retry: 0,
    next_at: 0,
    seq: 0,
    failed: 0,
    ...over,
  })

  it('不同 note 的同类任务不合并', async () => {
    await enqueue(task({ note_id: 'a' }))
    await enqueue(task({ note_id: 'b' }))

    expect(await db.outbox.count()).toBe(2)
  })

  it('同 note 同类任务合并成一条，seq 递增且清掉失败态', async () => {
    await enqueue(task({ payload: { star: 1 } }))
    await db.outbox.toCollection().modify({ failed: 1, retry: 3 })
    await enqueue(task({ payload: { star: 0 } }))

    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ payload: { star: 0 }, seq: 2, failed: 0, retry: 0 })
  })
})

describe('purge', () => {
  it('purgeNote 物理删行并入队 scope=note 的 purge 任务', async () => {
    const a = await createNote('a')
    await purgeNote(a.id)

    expect(await db.notes.get(a.id)).toBeUndefined()
    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ note_id: a.id, kind: 'purge', payload: { scope: 'note' } })
  })

  it('purgeTrash 批量删除所有回收站笔记，只入队一条 scope=trash 任务', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    await trashNote(a.id)
    await trashNote(b.id)

    await purgeTrash()

    expect(await db.notes.count()).toBe(0)
    const rows = await db.outbox.where('kind').equals('purge').toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ note_id: '__trash__', kind: 'purge', payload: { scope: 'trash' } })
  })

  it('purgeTrash 在回收站为空时不入队', async () => {
    await purgeTrash()

    expect(await db.outbox.count()).toBe(0)
  })
})

describe('createNote 指定分组', () => {
  it('可直接建在某个分组里，create 任务带上 group_id', async () => {
    const note = await createNote('内容', { group_id: 'g1' })

    expect(note.group_id).toBe('g1')
    expect((await getNote(note.id))!.group_id).toBe('g1')
    const task = await db.outbox.where('kind').equals('create').first()
    expect(task!.payload).toMatchObject({ group_id: 'g1' })
  })

  it('不指定分组时仍为未分组', async () => {
    const note = await createNote('内容')
    expect(note.group_id).toBeNull()
  })
})

describe('updateBody 基线校验', () => {
  it('库里正文已被别处改写时，先把它另存为冲突副本再覆盖', async () => {
    const note = await createNote('原文')
    await updateProps(note.id, { group_id: 'g1' })
    // 模拟 pull 在编辑期间把远端正文落了库：编辑器手里的基线仍是「原文」
    await db.notes.update(note.id, { body: '另一台设备写的', body_version: 2, version: 2 })

    await updateBody(note.id, '原文加上本机继续敲的字', '原文')

    const all = await db.notes.toArray()
    const original = all.find((n) => n.id === note.id)!
    const copy = all.find((n) => n.id !== note.id)!
    // 后写者胜：本机内容留在原笔记；被覆盖的远端正文不能凭空消失
    expect(original.body).toBe('原文加上本机继续敲的字')
    expect(copy.body).toContain('另一台设备写的')
    expect(copy.title).toContain(CONFLICT_SUFFIX)
    // 副本就地放在原笔记的分组里
    expect(copy.group_id).toBe('g1')
  })

  it('基线与库中正文一致时不产生副本', async () => {
    const note = await createNote('原文')

    await updateBody(note.id, '原文改一改', '原文')

    expect(await db.notes.count()).toBe(1)
  })

  it('自己上一次保存的回显不算冲突', async () => {
    const note = await createNote('原文')
    await updateBody(note.id, '第一段', '原文')

    await updateBody(note.id, '第一段和第二段', '第一段')

    expect(await db.notes.count()).toBe(1)
  })

  it('不传基线时保持旧行为，不做校验', async () => {
    const note = await createNote('原文')
    await db.notes.update(note.id, { body: '别处改的' })

    await updateBody(note.id, '直接覆盖')

    expect(await db.notes.count()).toBe(1)
    expect((await getNote(note.id))!.body).toBe('直接覆盖')
  })

  it('要写入的内容与库中正文相同时，即便基线不同也不产生副本', async () => {
    const note = await createNote('原文')
    await db.notes.update(note.id, { body: '同一份' })

    await updateBody(note.id, '同一份', '原文')

    expect(await db.notes.count()).toBe(1)
  })
})

describe('createConflictCopy', () => {
  it('标题加冲突后缀、正文原样保留、继承原笔记分组并入队', async () => {
    const note = await createNote('内容', { group_id: 'g1' })
    await db.outbox.clear()

    const copy = await createConflictCopy((await getNote(note.id))!, '# 会议纪要\n我的版本')

    expect(copy.title).toBe(`会议纪要${CONFLICT_SUFFIX}`)
    expect(copy.body).toContain('# 会议纪要\n我的版本')
    expect(copy.group_id).toBe('g1')
    const task = await db.outbox.where('[note_id+kind]').equals([copy.id, 'create']).first()
    expect(task!.payload).toMatchObject({ group_id: 'g1' })
  })

  it('超长标题下后缀不会被截断吞掉', async () => {
    const note = await createNote('内容')

    const copy = await createConflictCopy(note, `# ${'标'.repeat(80)}`)

    expect(copy.title.endsWith(CONFLICT_SUFFIX)).toBe(true)
    expect(copy.title.length).toBeLessThanOrEqual(64)
  })

  it('没有可用标题时落到「无标题」', async () => {
    const note = await createNote('内容')

    const copy = await createConflictCopy(note, '![](data:image/png;base64,xxx)')

    expect(copy.title).toBe(`无标题${CONFLICT_SUFFIX}`)
  })
})

describe('trash / recover 互相抵消', () => {
  it('离线「删除 → 恢复 → 删除」后 outbox 只剩最后一次删除，且排在最后', async () => {
    const note = await createNote('a')
    await trashNote(note.id)
    await recoverNote(note.id)
    await trashNote(note.id)

    const tasks = (await db.outbox.where('note_id').equals(note.id).toArray()).sort(
      (x, y) => x.id! - y.id!
    )
    // 合并进旧位置的话，服务端会按「删除 → 恢复」执行，最终两端状态相反
    expect(tasks.map((t) => t.kind)).toEqual(['create', 'trash'])
    expect((await getNote(note.id))!.invalid).toBe(1)
  })

  it('「删除 → 恢复」后只剩恢复任务', async () => {
    const note = await createNote('a')
    await trashNote(note.id)
    await recoverNote(note.id)

    const kinds = (await db.outbox.where('note_id').equals(note.id).toArray()).map((t) => t.kind)
    expect(kinds).not.toContain('trash')
    expect(kinds).toContain('recover')
  })
})
