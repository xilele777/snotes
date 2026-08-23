import type { NoteMeta } from '../shared/types'

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
