import { CONFLICT_SUFFIX, createConflictCopy } from '../db/repo'
import { db } from '../db/schema'
import type { ConflictInfo } from './push'

export { CONFLICT_SUFFIX }

/**
 * 把 push 报上来的冲突各存一份副本。规格 §8.5：后写者胜，但被覆盖的正文不能消失。
 * conflict.body 是服务端随 conflicted 响应带回的、刚被本地这次推送覆盖掉的正文——
 * 它在服务端已经不存在了，这里是它唯一的落脚点，原笔记本地已不在也照样保存。
 */
export async function saveConflictCopies(conflicts: ConflictInfo[]): Promise<string[]> {
  const created: string[] = []

  for (const conflict of conflicts) {
    const original = await db.notes.get(conflict.note_id)
    // 副本建在原笔记的分组里便于就地找到；原笔记已被本地删掉就落到未分组
    const copy = await createConflictCopy(original ?? { group_id: null }, conflict.body)
    created.push(copy.id)
  }

  return created
}
