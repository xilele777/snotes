import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { createNote } from '../db/repo'
import { stageDraft, unsavedDrafts } from '../editor/save-session'
import { openWorkspacePage } from '../navigation'
import { retrySyncNow } from '../sync/engine'
import NoteSaveStatus from './NoteSaveStatus.vue'

vi.mock('../navigation', () => ({ openWorkspacePage: vi.fn() }))
vi.mock('../sync/engine', () => ({ retrySyncNow: vi.fn().mockResolvedValue(undefined) }))
enableAutoUnmount(afterEach)
beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  unsavedDrafts.value = []
  vi.clearAllMocks()
})
afterEach(() => { unsavedDrafts.value = []; vi.restoreAllMocks() })

it('区分编辑中、本机待上传、同步失败与已同步；可重试', async () => {
  const note = await createNote('正文')
  const wrapper = mount(NoteSaveStatus, { props: { noteId: note.id, pending: true } })
  expect(wrapper.text()).toContain('正在保存到本机')
  await wrapper.setProps({ pending: false })
  await vi.waitFor(() => expect(wrapper.text()).toContain('等待同步'))
  await db.outbox.where('note_id').equals(note.id).modify({ failed: 1 })
  await vi.waitFor(() => expect(wrapper.text()).toContain('同步待重试'))
  await wrapper.get('button').trigger('click')
  expect(retrySyncNow).toHaveBeenCalledOnce()
  await db.transaction('rw', db.notes, db.outbox, async () => {
    await db.notes.update(note.id, { dirty: 'none' })
    await db.outbox.where('note_id').equals(note.id).delete()
  })
  await vi.waitFor(() => expect(wrapper.text()).toBe('已保存并同步'))
})

it('草稿写入失败优先于离线提示，并进入草稿恢复', async () => {
  const note = await createNote('原文')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  stageDraft(note.id, '尚未写入', '原文')
  unsavedDrafts.value[0]!.error = '存储已满'
  const wrapper = mount(NoteSaveStatus, { props: { noteId: note.id, pending: false } })
  expect(wrapper.text()).toContain('本地保存异常')
  await wrapper.get('button').trigger('click')
  expect(openWorkspacePage).toHaveBeenCalledWith('settings', 'data')
})

it('读取状态失败不会误报正文丢失，并可以重新订阅', async () => {
  const note = await createNote('正文')
  vi.spyOn(db.notes, 'get').mockRejectedValueOnce(new Error('暂时无法读取'))
  const wrapper = mount(NoteSaveStatus, { props: { noteId: note.id, pending: false } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('保存状态读取失败'))
  await wrapper.get('button').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('等待同步'))
  expect(openWorkspacePage).not.toHaveBeenCalled()
})

it('切换笔记后只反映当前笔记状态，离线提示随网络事件更新', async () => {
  const synced = await createNote('已同步')
  const pending = await createNote('未同步')
  await db.notes.update(synced.id, { dirty: 'none' })
  await db.outbox.where('note_id').equals(synced.id).delete()
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  const wrapper = mount(NoteSaveStatus, { props: { noteId: pending.id, pending: false } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('等待同步'))
  await wrapper.setProps({ noteId: synced.id })
  await vi.waitFor(() => expect(wrapper.text()).toBe('已保存并同步'))
  online.mockReturnValue(false)
  window.dispatchEvent(new Event('offline'))
  await vi.waitFor(() => expect(wrapper.text()).toBe('已保存到本机 · 离线'))
  online.mockReturnValue(true)
  window.dispatchEvent(new Event('online'))
  await vi.waitFor(() => expect(wrapper.text()).toBe('已保存并同步'))
})
