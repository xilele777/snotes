import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Group, OutboxTask } from '../../shared/types'
import { db } from '../db/schema'
import { enqueue } from '../db/repo'

/** 分组上可以直接修改并同步到服务端的字段（PATCH /api/groups/:id 接受的三项） */
export type GroupPatch = Partial<Pick<Group, 'name' | 'color' | 'ord'>>

export const useGroupsStore = defineStore('groups', () => {
  const groups = ref<Group[]>([])

  const groupTask = (
    groupId: string,
    kind: OutboxTask['kind'],
    payload: Record<string, unknown>
  ): OutboxTask => ({
    note_id: groupId,
    kind,
    payload: { scope: 'group', ...payload },
    retry: 0,
    next_at: 0,
    seq: 0,
    failed: 0,
  })

  async function load() {
    const all = await db.groups.toArray()
    groups.value = all
      .filter((g) => g.invalid === 0)
      .sort((a, b) => a.ord - b.ord || a.group_id.localeCompare(b.group_id))
  }

  /** 导入备份时会带着颜色一起建组，平时新建只有名字 */
  async function create(name: string, options: { color?: string | null } = {}) {
    const group: Group = {
      group_id: crypto.randomUUID(),
      name,
      ord: groups.value.length,
      color: options.color ?? null,
      invalid: 0,
      update_time: Date.now(),
    }

    await db.groups.add(group)
    await enqueue(groupTask(group.group_id, 'create', { group_id: group.group_id, name, ord: group.ord, color: group.color }))
    await load()

    return group
  }

  /**
   * 同一分组连续改多个属性（先改名再改色）要累积成一个 payload：
   * mergeTask 只保留最新 payload，不合并的话先改的那项在推送时就丢了。
   */
  async function enqueueProp(groupId: string, changes: GroupPatch) {
    const existing = await db.outbox.where('[note_id+kind]').equals([groupId, 'prop']).first()
    const previous = (existing?.payload as Record<string, unknown> | undefined) ?? {}
    await enqueue(groupTask(groupId, 'prop', { ...previous, ...changes }))
  }

  async function patch(groupId: string, changes: GroupPatch) {
    await db.groups.update(groupId, { ...changes, update_time: Date.now() })
    await enqueueProp(groupId, changes)
    await load()
  }

  const rename = (groupId: string, name: string) => patch(groupId, { name })

  const setColor = (groupId: string, color: string | null) => patch(groupId, { color })

  /**
   * 上移 / 下移一格。按当前显示顺序重排后，把 ord 与新下标不一致的分组全部写回：
   * 旧数据里 ord 可能重复（早期都是 0），只交换两项的 ord 排不出稳定顺序，
   * 顺手把整列 ord 归一成 0..n-1。
   */
  async function move(groupId: string, delta: -1 | 1) {
    await load()
    const list = [...groups.value]
    const from = list.findIndex((g) => g.group_id === groupId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= list.length) return

    ;[list[from], list[to]] = [list[to], list[from]]
    const changed = list
      .map((group, ord) => ({ group, ord }))
      .filter(({ group, ord }) => group.ord !== ord)
    if (changed.length === 0) return

    const now = Date.now()
    await db.transaction('rw', db.groups, () =>
      Promise.all(changed.map(({ group, ord }) => db.groups.update(group.group_id, { ord, update_time: now })))
    )
    for (const { group, ord } of changed) await enqueueProp(group.group_id, { ord })
    await load()
  }

  async function remove(groupId: string) {
    await db.transaction('rw', db.groups, db.notes, async () => {
      await db.groups.update(groupId, { invalid: 1, update_time: Date.now() })
      // 组内笔记回到未分组（规格 §7.3），不级联删除笔记
      await db.notes.where('group_id').equals(groupId).modify({ group_id: null })
    })
    await enqueue(groupTask(groupId, 'trash', {}))
    await load()
  }

  return { groups, load, create, rename, setColor, move, remove }
})
