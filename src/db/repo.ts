import { derive } from '../../shared/derive'
import { mergeTask } from '../../shared/outbox'
import type { LocalNote, NoteMeta, OutboxTask } from '../../shared/types'
import { emitLocalWrite } from '../sync/signal'
import { db } from './schema'

export type ListView = 'all' | 'trash' | 'star' | 'group'

export interface ListFilter {
  view: ListView
  groupId?: string | null
}

export type NoteProps = Partial<Pick<NoteMeta, 'group_id' | 'star' | 'top' | 'skin_color'>>

/** 事务内部用：调用方负责把它包进 db.transaction */
async function enqueueIn(task: OutboxTask): Promise<void> {
  const existing = await db.outbox.where('[note_id+kind]').equals([task.note_id, task.kind]).first()
  // put 而不是 update：merged 里带着主键 id，Dexie 的 update() 对「changes 里含主键」
  // 的处理在各版本间不一致，put 的语义（有则覆盖、无则插入）是确定的。
  await db.outbox.put(mergeTask(existing, task))
}

export async function enqueue(task: OutboxTask): Promise<void> {
  await db.transaction('rw', db.outbox, () => enqueueIn(task))
  emitLocalWrite()
}

function bumpDirty(current: LocalNote['dirty'], add: 'body' | 'prop'): LocalNote['dirty'] {
  if (current === 'both' || (current === 'body' && add === 'prop') || (current === 'prop' && add === 'body')) {
    return 'both'
  }
  return add
}

const newTask = (over: Pick<OutboxTask, 'note_id' | 'kind' | 'payload'>): OutboxTask => ({
  retry: 0,
  next_at: 0,
  seq: 0,
  failed: 0,
  ...over,
})

export async function createNote(content: string): Promise<LocalNote> {
  const now = Date.now()
  const { title, summary, thumbnail } = derive(content)

  const note: LocalNote = {
    id: crypto.randomUUID(),
    group_id: null,
    title,
    summary,
    thumbnail,
    version: 0,
    prop_version: 0,
    star: 0,
    top: 0,
    skin_color: null,
    invalid: 0,
    create_time: now,
    update_time: now,
    body: content,
    // 0 = 服务端还没确认过任何版本；create 成功后由 applyAck 写成 1
    body_version: 0,
    dirty: 'both',
  }

  await db.transaction('rw', db.notes, db.outbox, async () => {
    await db.notes.add(note)
    await enqueueIn(
      newTask({
        note_id: note.id,
        kind: 'create',
        payload: { id: note.id, create_time: note.create_time, content, title, summary, thumbnail },
      })
    )
  })

  emitLocalWrite()
  return note
}

export async function updateBody(id: string, content: string): Promise<void> {
  const { title, summary, thumbnail } = derive(content)

  await db.transaction('rw', db.notes, db.outbox, async () => {
    const note = await db.notes.get(id)
    if (!note) return

    await db.notes.update(id, {
      body: content,
      // body_version 刻意不动：刚敲出来的正文还没有服务端版本号。
      // 「本地有未推送内容」由 dirty 与 outbox 表达，不由版本号表达。
      title,
      summary,
      thumbnail,
      update_time: Date.now(),
      dirty: bumpDirty(note.dirty, 'body'),
    })

    await enqueueIn(
      newTask({
        note_id: id,
        kind: 'body',
        payload: { content, title, summary, thumbnail, base_version: note.version },
      })
    )
  })

  emitLocalWrite()
}

export async function updateProps(id: string, props: NoteProps): Promise<void> {
  await db.transaction('rw', db.notes, db.outbox, async () => {
    const note = await db.notes.get(id)
    if (!note) return

    await db.notes.update(id, {
      ...props,
      update_time: Date.now(),
      dirty: bumpDirty(note.dirty, 'prop'),
    })

    // 同一条笔记的多次属性修改要累积成一个 payload：先改星标再改置顶，
    // 两个字段都得发出去，而 mergeTask 只保留最新 payload。
    const existing = await db.outbox.where('[note_id+kind]').equals([id, 'prop']).first()
    const previous = (existing?.payload as NoteProps | undefined) ?? {}

    await enqueueIn(
      newTask({
        note_id: id,
        kind: 'prop',
        payload: { ...previous, ...props, base_prop_version: note.prop_version },
      })
    )
  })

  emitLocalWrite()
}

async function setInvalid(id: string, invalid: 0 | 1, kind: 'trash' | 'recover') {
  await db.transaction('rw', db.notes, db.outbox, async () => {
    const note = await db.notes.get(id)
    if (!note) return

    await db.notes.update(id, {
      invalid,
      update_time: Date.now(),
      dirty: bumpDirty(note.dirty, 'prop'),
    })

    await enqueueIn(newTask({ note_id: id, kind, payload: {} }))
  })

  emitLocalWrite()
}

export const trashNote = (id: string) => setInvalid(id, 1, 'trash')
export const recoverNote = (id: string) => setInvalid(id, 0, 'recover')

/**
 * 物理删除单条笔记（回收站里的「彻底删除」）。
 * 本地直接删行，入队一条 scope='note' 的 purge 任务，push 时走 POST /api/notes/:id/purge。
 * 笔记行都没了，applyAck 里 db.notes.get 会返回 undefined 而提前返回，清脏位那套逻辑不参与。
 */
export async function purgeNote(id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.outbox, async () => {
    await db.notes.delete(id)
    // 笔记行都要物理删了，它名下还没推出去的 create/body/prop 任务已无意义，
    // 留着会让 push 多发一次注定 404 的请求。先清掉，再入队唯一的 purge。
    await db.outbox.where('note_id').equals(id).delete()
    await enqueueIn(newTask({ note_id: id, kind: 'purge', payload: { scope: 'note' } }))
  })
  emitLocalWrite()
}

/**
 * 清空回收站：本地批量删除所有 invalid=1 的笔记，入队一条 scope='trash' 的 purge 任务。
 * push 时走 POST /api/trash/clean（见 Task 20 Step 3 的 send()）。
 * 用固定 note_id '__trash__' 让 (note_id+kind) 复合索引不会和任何单条 purge 冲突，
 * 多次调用会合并成同一行（payload 都是 { scope: 'trash' }，幂等）。
 */
export async function purgeTrash(): Promise<void> {
  await db.transaction('rw', db.notes, db.outbox, async () => {
    const trashed = await db.notes.where('invalid').equals(1).toArray()
    if (trashed.length === 0) return

    await db.notes.bulkDelete(trashed.map((n) => n.id))
    await enqueueIn(newTask({ note_id: '__trash__', kind: 'purge', payload: { scope: 'trash' } }))
  })
  emitLocalWrite()
}

export function getNote(id: string): Promise<LocalNote | undefined> {
  return db.notes.get(id)
}

export async function listNotes(filter: ListFilter): Promise<LocalNote[]> {
  const all = await db.notes.toArray()

  const matched = all.filter((n) => {
    if (filter.view === 'trash') return n.invalid === 1
    if (n.invalid === 1) return false
    if (filter.view === 'star') return n.star === 1
    if (filter.view === 'group') return n.group_id === filter.groupId
    return true
  })

  // id 兜底是为了确定性：同一毫秒创建的多条笔记 update_time 相同，
  // 少了这一级比较，列表顺序会随 Dexie 的返回顺序漂移，界面和测试都会抖。
  return matched.sort(
    (a, b) => b.top - a.top || b.update_time - a.update_time || a.id.localeCompare(b.id)
  )
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}
