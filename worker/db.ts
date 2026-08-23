import type { NoteMeta } from '../shared/types'
import type { Env } from './types'

export function nowMs(): number {
  return Date.now()
}

/** D1 行（字段值可能是 number/string/null）映射为 NoteMeta。 */
export function rowToNoteMeta(row: Record<string, unknown>): NoteMeta {
  return {
    id: row.id as string,
    group_id: (row.group_id as string | null) ?? null,
    title: (row.title as string) ?? '',
    summary: (row.summary as string) ?? '',
    thumbnail: (row.thumbnail as string | null) ?? null,
    version: Number(row.version),
    prop_version: Number(row.prop_version),
    star: Number(row.star) === 1 ? 1 : 0,
    top: Number(row.top) === 1 ? 1 : 0,
    skin_color: (row.skin_color as string | null) ?? null,
    invalid: Number(row.invalid) === 1 ? 1 : 0,
    create_time: Number(row.create_time),
    update_time: Number(row.update_time),
  }
}

/**
 * 物理删除笔记：先回收 R2 图片，再删 image / note_body / note 行。
 * image 表故意没有指向 note 的外键（图片生命周期由业务显式控制，规格 §9.4），
 * 因此级联覆盖不到它——删 R2 对象本来就要先把 file_key 查出来，顺手把三张表一并删。
 */
export async function purgeNotes(env: Env, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const placeholders = ids.map(() => '?').join(', ')

  const { results } = await env.DB.prepare(
    `SELECT file_key FROM image WHERE note_id IN (${placeholders})`
  )
    .bind(...ids)
    .all<{ file_key: string }>()

  await Promise.all(results.map((r) => env.R2.delete(r.file_key)))

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM image WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note_body WHERE note_id IN (${placeholders})`).bind(...ids),
    env.DB.prepare(`DELETE FROM note WHERE id IN (${placeholders})`).bind(...ids),
  ])
}
