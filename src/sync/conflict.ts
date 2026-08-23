import { TITLE_MAX, extractTitle } from '../../shared/derive'
import { createNote, updateProps } from '../db/repo'
import { db } from '../db/schema'
import type { ConflictInfo } from './push'

export const CONFLICT_SUFFIX = '（冲突副本）'

export async function saveConflictCopies(conflicts: ConflictInfo[]): Promise<string[]> {
  const created: string[] = []

  for (const conflict of conflicts) {
    const original = await db.notes.get(conflict.note_id)
    if (!original) continue

    // 先按 TITLE_MAX 减去后缀长度截断原标题，否则 derive 再截一次会把后缀吃掉，
    // 副本看起来就和普通笔记没有区别了
    const base = (extractTitle(conflict.local_body) || '无标题').slice(
      0,
      TITLE_MAX - CONFLICT_SUFFIX.length
    )
    const content = `# ${base}${CONFLICT_SUFFIX}\n\n${conflict.local_body}`

    const copy = await createNote(content)

    // 走 updateProps 而不是 db.notes.update：后者只改本地，
    // 副本在其他设备上会掉出分组，等于「就地找到」这个设计意图落空
    if (original.group_id) {
      await updateProps(copy.id, { group_id: original.group_id })
    }

    created.push(copy.id)
  }

  return created
}
