import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { useNotesStore } from './notes'
import { useUiStore } from './ui'
import * as repo from '../db/repo'

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

  it('load 时若无选中项默认选中列表第一条', async () => {
    const store = useNotesStore()
    await store.create()
    await store.create()
    store.currentId = null

    await store.load()

    // 列表先后没保证（可能同毫秒），断言落在列表当前第一项而非 null 即可
    expect(store.currentId).toBe(store.notes[0].id)
    expect(store.currentId).not.toBeNull()
  })

  it('load 后列表为空时选中项保持 null', async () => {
    const store = useNotesStore()

    await store.load()

    expect(store.currentId).toBeNull()
  })

  it('并发 load 时丢弃较早视图的晚到结果', async () => {
    const store = useNotesStore()
    const ui = useUiStore()
    let resolveFirst!: (rows: Awaited<ReturnType<typeof repo.listNotes>>) => void
    const first = new Promise<Awaited<ReturnType<typeof repo.listNotes>>>((resolve) => { resolveFirst = resolve })
    const list = vi.spyOn(repo, 'listNotes')
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce([])

    const oldLoad = store.load()
    ui.view = 'star'
    await store.load()
    resolveFirst([{ id: 'old' } as Awaited<ReturnType<typeof repo.listNotes>>[number]])
    await oldLoad

    expect(store.stale).toBe(false)
    expect(store.notes).toEqual([])
    list.mockRestore()
  })

  it('currentId 指不到列表里任何笔记时，load 会重选到列表第一条', async () => {
    const store = useNotesStore()
    await store.create()
    await store.create()
    store.currentId = '不存在的 id'

    await store.load()

    expect(store.currentId).toBe(store.notes[0].id)
  })
})

describe('notes store 移动端默认选中', () => {
  it('移动端 load 时不默认选中第一条，保持 null 以先展示目录页', async () => {
    // isMobile 依赖 window.matchMedia，单测里置为窄屏分支
    vi.stubGlobal('matchMedia', (query: string) =>
      ({ matches: query.includes('720'), media: query, onchange: null,
        addEventListener: () => undefined, removeEventListener: () => undefined,
        addListener: () => undefined, removeListener: () => undefined,
        dispatchEvent: () => false }) as unknown as MediaQueryList)

    const store = useNotesStore()
    await store.create()
    await store.create()
    store.currentId = null

    await store.load()

    expect(store.currentId).toBeNull()

    vi.unstubAllGlobals()
  })

  it('桌面端 load 时仍默认选中列表第一条', async () => {
    const store = useNotesStore()
    await store.create()
    await store.create()
    store.currentId = null

    await store.load()

    expect(store.currentId).not.toBeNull()
  })
})

describe('notes store 打开跟踪', () => {
  it('切换 currentId 到非 null 时递增 open_count 且不改 update_time', async () => {
    const store = useNotesStore()
    const note = await store.create()
    await store.saveBody(note.id, '内容')

    // 先把打开次数与时间归位到一个已知状态：手动写库再 load，
    // 规避 create 选中触发的异步 openNote 与 load 的竞争。
    await db.notes.update(note.id, { open_count: 0, last_open_time: 0 })
    await store.load()

    const before = store.notes.find((n) => n.id === note.id)!
    const beforeUpdate = before.update_time
    expect(before.open_count).toBe(0)

    store.currentId = null
    store.currentId = note.id
    // watch 默认异步 flush，等它触发后再读内存数组
    await nextTick()

    const after = store.notes.find((n) => n.id === note.id)!
    expect(after.open_count).toBe(1)
    expect(after.update_time).toBe(beforeUpdate)

    await vi.waitFor(async () => {
      const row = await db.notes.get(note.id)
      expect(row!.open_count).toBe(1)
    })
  })

  it('切到 null 不计打开次数', async () => {
    const store = useNotesStore()
    const note = await store.create()
    const before = store.notes.find((n) => n.id === note.id)!.open_count ?? 0

    store.currentId = null

    const after = store.notes.find((n) => n.id === note.id)!.open_count ?? 0
    expect(after).toBe(before)
  })
})
