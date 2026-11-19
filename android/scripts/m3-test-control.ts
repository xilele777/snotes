// Imported only by isolated Android test entrypoints, never by production builds.
import type { Database } from '../../worker/storage'
export const TEST_TOKEN = 'android-m3-test-token'

export async function testRestore(request: Request, db: Database): Promise<Response> {
  if (request.method !== 'POST' || request.headers.get('Authorization') !== `Bearer ${TEST_TOKEN}`) return new Response('', { status: 401 })
  const value = await request.json() as { id: string; missing_id: string; book_id: string; change_epoch: boolean }
  if (![value.id, value.missing_id, value.book_id].every(id => /^[A-Za-z0-9_-]{1,100}$/.test(id))) return Response.json({ error: 'invalid_test_id' }, { status: 400 })
  const clock = await db.prepare('SELECT watermark FROM note_sync_clock WHERE id = 1').first<{ watermark: number }>()
  await db.batch([
    db.prepare("UPDATE note_body SET content = 'backup text', version = 1 WHERE note_id = ?").bind(value.id),
    db.prepare("UPDATE note SET title = 'backup text', summary = '', version = 1, update_time = 1 WHERE id = ?").bind(value.id),
    db.prepare('DELETE FROM note_body WHERE note_id = ?').bind(value.missing_id),
    db.prepare('DELETE FROM note WHERE id = ?').bind(value.missing_id),
    db.prepare('DELETE FROM knowledge_base_toc WHERE knowledge_base_id = ?').bind(value.book_id),
    db.prepare('DELETE FROM knowledge_base_toc_history WHERE knowledge_base_id = ?').bind(value.book_id),
    db.prepare('DELETE FROM knowledge_base_operation WHERE knowledge_base_id = ?').bind(value.book_id),
    db.prepare('DELETE FROM knowledge_base WHERE id = ?').bind(value.book_id),
    // Simulate a changed database at exactly the old note watermark: revision must still reject its receipt.
    db.prepare('UPDATE note_sync_clock SET watermark = ? WHERE id = 1').bind(clock!.watermark),
    ...(value.change_epoch ? [db.prepare('UPDATE sync_instance SET epoch = ? WHERE id = 1').bind(crypto.randomUUID())] : []),
  ])
  return Response.json({ ok: true })
}
