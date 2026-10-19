import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DataPane from './DataPane.vue'
import { db } from '../../db/schema'
import { discardDraft, stageDraft, unsavedDrafts } from '../../editor/save-session'
import { retrySyncNow } from '../../sync/engine'

vi.mock('../../sync/engine', () => ({ retrySyncNow: vi.fn().mockResolvedValue(undefined) }))
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  for (const draft of [...unsavedDrafts.value]) discardDraft(draft.journalKey)
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(() => wrapper?.unmount())

it('失去原笔记的失败草稿可从数据页恢复为独立副本，并在成功后清除日志', async () => {
  stageDraft('missing-note', '# 尚未保存的正文\n\n最后几个字', '原文')
  wrapper = mount(DataPane)
  expect(wrapper.text()).toContain('尚未保存到本机')
  const retry = wrapper.findAll('button').find(button => button.text() === '重试保存')!
  await retry.trigger('click')
  await vi.waitFor(async () => {
    const notes = await db.notes.toArray()
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toContain('最后几个字')
    expect(unsavedDrafts.value).toHaveLength(0)
    expect(await db.outbox.count()).toBe(1)
  })
  await flushPromises()
  expect(wrapper.text()).toContain('草稿已保存到本机')
})

it('失败任务显示服务端原因并提供显式重试入口', async () => {
  await db.outbox.add({ note_id: 'note', kind: 'body', payload: { content: '本地正文' }, failed: 1, seq: 1, retry: 0, next_at: 0, last_error: 'HTTP 413: content_too_large' })
  wrapper = mount(DataPane)
  await vi.waitFor(() => expect(wrapper!.text()).toContain('HTTP 413'))
  const retry = wrapper.findAll('button').find(button => button.text() === '重试失败任务')!
  await retry.trigger('click')
  expect(retrySyncNow).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('下载任务数据')
})
