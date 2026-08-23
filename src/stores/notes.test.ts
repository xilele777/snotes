import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/schema'
import { useNotesStore } from './notes'
import { useUiStore } from './ui'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

describe('notes store', () => {
  it('create 后列表立即包含新笔记并选中它', async () => {
    const store = useNotesStore()
    const note = await store.create()

    expect(store.notes.map((n) => n.id)).toContain(note.id)
    expect(store.currentId).toBe(note.id)
    expect(store.current?.id).toBe(note.id)
  })

  it('saveBody 更新列表中的标题', async () => {
    const store = useNotesStore()
    const note = await store.create()

    await store.saveBody(note.id, '# 新标题\n内容')

    expect(store.notes.find((n) => n.id === note.id)!.title).toBe('新标题')
  })

  it('setProps 更新星标并重排序', async () => {
    const store = useNotesStore()
    const a = await store.create()
    const b = await store.create()

    await store.setProps(a.id, { top: 1 })

    expect(store.notes[0].id).toBe(a.id)
    expect(store.notes[1].id).toBe(b.id)
  })

  it('trash 后默认视图不再包含该笔记', async () => {
    const store = useNotesStore()
    const note = await store.create()

    await store.trash(note.id)

    expect(store.notes.map((n) => n.id)).not.toContain(note.id)
  })

  it('trash 当前笔记后自动切到列表中的下一条', async () => {
    const store = useNotesStore()
    const a = await store.create()
    const b = await store.create()
    store.currentId = b.id

    await store.trash(b.id)

    expect(store.currentId).toBe(a.id)
  })

  it('回收站视图列出已删除的笔记', async () => {
    const store = useNotesStore()
    const ui = useUiStore()
    const note = await store.create()
    await store.trash(note.id)

    ui.view = 'trash'
    await store.load()

    expect(store.notes.map((n) => n.id)).toEqual([note.id])
  })

  it('搜索过滤标题与正文，大小写不敏感', async () => {
    const store = useNotesStore()
    const ui = useUiStore()
    await store.create()
    const target = await store.create()
    await store.saveBody(target.id, 'Hello World')

    ui.query = 'hello'

    expect(store.visible.map((n) => n.id)).toEqual([target.id])
  })

  it('搜索结果标题命中优先于正文命中', async () => {
    const store = useNotesStore()
    const ui = useUiStore()
    const bodyHit = await store.create()
    await store.saveBody(bodyHit.id, '无关标题\n里面提到 关键词')
    const titleHit = await store.create()
    await store.saveBody(titleHit.id, '关键词在标题')

    ui.query = '关键词'

    expect(store.visible.map((n) => n.id)).toEqual([titleHit.id, bodyHit.id])
  })

  it('空搜索词返回全部', async () => {
    const store = useNotesStore()
    const ui = useUiStore()
    await store.create()
    await store.create()

    ui.query = '   '

    expect(store.visible).toHaveLength(2)
  })
})
