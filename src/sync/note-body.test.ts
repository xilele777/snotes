import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { createNote } from '../db/repo'
import { refreshNoteBodyOnOpen } from './note-body'
import { apiFetch } from '../api/client'

vi.mock('../api/client', () => ({ apiFetch: vi.fn() }))
beforeEach(async () => { await db.delete(); await db.open(); vi.clearAllMocks() })

it('手动重试补齐同版本缺失正文，合法空正文也可恢复', async () => {
  const note = await createNote('')
  await db.outbox.clear()
  await db.notes.update(note.id, { dirty: 'none', body_version: 3 })
  await db.bodies.delete(note.id)
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('网络暂不可用'))
  await expect(refreshNoteBodyOnOpen(note.id)).rejects.toThrow('网络暂不可用')
  vi.mocked(apiFetch).mockResolvedValue({ bodies: [{ note_id: note.id, content: '', version: 3 }] })
  expect(await refreshNoteBodyOnOpen(note.id, true)).toBe('')
  expect((await db.bodies.get(note.id))?.body).toBe('')
})

it('重试也不会覆盖未同步的本地正文', async () => {
  const note = await createNote('未同步内容')
  expect(await refreshNoteBodyOnOpen(note.id, true)).toBeUndefined()
  expect(apiFetch).not.toHaveBeenCalled()
  expect((await db.bodies.get(note.id))?.body).toBe('未同步内容')
})
