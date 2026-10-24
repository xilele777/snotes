import { beforeEach, expect, it, vi } from 'vitest'
import { discardDraft, saveDraft, stageDraft, unsavedDrafts, waitForDraftSaves } from './save-session'

beforeEach(() => {
  for (const draft of [...unsavedDrafts.value]) discardDraft(draft.id)
  localStorage.clear()
})

it('失败保留持久草稿，重试成功后才清除', async () => {
  stageDraft('a', '最新正文', '原文')
  await expect(saveDraft('a', async () => { throw new Error('quota') })).rejects.toThrow('quota')
  const key = unsavedDrafts.value[0].journalKey
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ body: '最新正文', base: '原文', error: 'quota' })
  expect(await waitForDraftSaves()).toBe(false)
  const save = vi.fn().mockResolvedValue(undefined)
  await saveDraft('a', save)
  expect(save).toHaveBeenCalledWith('a', '最新正文', '原文')
  expect(unsavedDrafts.value).toEqual([])
  expect(localStorage.getItem(key)).toBeNull()
})

it('在途保存不丢新正文，并使用已确认基线串行提交', async () => {
  let finish!: () => void
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
  stageDraft('a', '第一版', '原文')
  const pending = saveDraft('a', save)
  stageDraft('a', '第二版', '第一版')
  expect(saveDraft('a', save)).toBe(pending)
  finish()
  await pending
  expect(save.mock.calls).toEqual([['a', '第一版', '原文'], ['a', '第二版', '第一版']])
  expect(await waitForDraftSaves()).toBe(true)
})

it('本页保存成功不会删除另一个标签页同一笔记的失败草稿', async () => {
  const otherKey = 'snotes_unsaved_draft:other-tab'
  localStorage.setItem(otherKey, JSON.stringify({ id: 'a', body: '另一页未保存内容', base: '原文', updatedAt: 1 }))
  stageDraft('a', '本页内容', '原文')
  await saveDraft('a', async () => {})
  expect(JSON.parse(localStorage.getItem(otherKey)!)).toMatchObject({ body: '另一页未保存内容' })
})

it('重启读取失败草稿，新输入使用独立记录而不覆盖恢复记录', async () => {
  stageDraft('a', '崩溃前的内容', '原文')
  await expect(saveDraft('a', async () => { throw new Error('quota') })).rejects.toThrow('quota')
  const olderKey = unsavedDrafts.value[0].journalKey
  vi.resetModules()
  const reloaded = await import('./save-session')
  expect(reloaded.unsavedDrafts.value.map(d => d.body)).toEqual(['崩溃前的内容'])
  reloaded.stageDraft('a', '重新打开后输入', '另一版本')
  await reloaded.saveDraft('a', async () => {})
  expect(reloaded.unsavedDrafts.value.map(d => d.body)).toEqual(['崩溃前的内容'])
  expect(JSON.parse(localStorage.getItem(olderKey)!)).toMatchObject({ body: '崩溃前的内容' })
  reloaded.discardDraft(olderKey)
})

it('草稿存储也满时仍保留内存恢复入口，不能报告已安全保存', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage quota') })
  try {
    stageDraft('a', '不能丢掉的最后正文', '原文')
    await expect(saveDraft('a', async () => { throw new Error('IndexedDB quota') })).rejects.toThrow('IndexedDB quota')
    expect(unsavedDrafts.value[0]).toMatchObject({ body: '不能丢掉的最后正文', error: 'IndexedDB quota' })
    expect(await waitForDraftSaves()).toBe(false)
  } finally { storage.mockRestore() }
})

it('别页中途新落的草稿实时出现在本页列表，保存后随 storage 移除消失，且不阻塞本页更新刷新', async () => {
  const otherKey = 'snotes_unsaved_draft:live-other'
  const draft = { id: 'e', body: '别页正在编辑', base: '原文', updatedAt: 3 }
  localStorage.setItem(otherKey, JSON.stringify(draft))
  window.dispatchEvent(new StorageEvent('storage', { key: otherKey, newValue: JSON.stringify(draft), storageArea: localStorage }))
  expect(unsavedDrafts.value.map(d => d.body)).toContain('别页正在编辑')
  // 非本会话拥有的草稿不拦更新刷新——它已持久化，由别页自己负责。
  expect(await waitForDraftSaves()).toBe(true)
  localStorage.removeItem(otherKey)
  window.dispatchEvent(new StorageEvent('storage', { key: otherKey, newValue: null, storageArea: localStorage }))
  expect(unsavedDrafts.value.map(d => d.body)).not.toContain('别页正在编辑')
})

it('别页更新草稿时本页实时跟进新正文与新 base，重试保存用的是新内容', async () => {
  const otherKey = 'snotes_unsaved_draft:live-other-2'
  localStorage.setItem(otherKey, JSON.stringify({ id: 'c', body: '旧版', base: '原文', updatedAt: 1 }))
  window.dispatchEvent(new StorageEvent('storage', { key: otherKey, newValue: JSON.stringify({ id: 'c', body: '旧版', base: '原文', updatedAt: 1 }), storageArea: localStorage }))
  const updated = { id: 'c', body: '新版', base: '旧版', updatedAt: 2 }
  localStorage.setItem(otherKey, JSON.stringify(updated))
  window.dispatchEvent(new StorageEvent('storage', { key: otherKey, newValue: JSON.stringify(updated), storageArea: localStorage }))
  expect(unsavedDrafts.value[0]).toMatchObject({ body: '新版', base: '旧版' })
  const save = vi.fn().mockResolvedValue(undefined)
  await saveDraft('c', save)
  expect(save).toHaveBeenCalledWith('c', '新版', '旧版')
})

it('启动快照里的别页残留草稿不会阻塞本页更新刷新，本页自己的失败草稿仍会', async () => {
  // 模拟启动快照：直接把别页草稿塞进恢复列表（等价于 read() 在别页保存前读到）。
  const phantom = { id: 'f', body: '别页残留', base: '原文', updatedAt: 1, journalKey: 'snotes_unsaved_draft:phantom' }
  unsavedDrafts.value.push(phantom)
  expect(await waitForDraftSaves()).toBe(true)
  stageDraft('g', '本页未保存正文', '原文')
  await expect(saveDraft('g', async () => { throw new Error('quota') })).rejects.toThrow('quota')
  expect(await waitForDraftSaves()).toBe(false)
  discardDraft('f')
})
