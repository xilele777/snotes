import type { Env } from './types'

/** Keep keys durable until object storage confirms deletion. */
export async function cleanupDeletedNotebookImages(env: Env, bookId?: string) {
  const query = env.DB.prepare(`SELECT file_key FROM knowledge_base_deleted_image${bookId ? ' WHERE knowledge_base_id = ?' : ''}`)
  const { results } = await (bookId ? query.bind(bookId) : query).all<{ file_key: string }>()
  for (const { file_key } of results) {
    await env.R2.delete(file_key)
    await env.DB.prepare('DELETE FROM knowledge_base_deleted_image WHERE file_key = ?').bind(file_key).run()
  }
}
