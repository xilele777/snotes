import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Group, OutboxTask } from '../../shared/types'
import { db } from '../db/schema'
import { enqueue } from '../db/repo'

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

  async function create(name: string) {
    const group: Group = {
      group_id: crypto.randomUUID(),
      name,
      ord: groups.value.length,
      color: null,
      invalid: 0,
      update_time: Date.now(),
    }

    await db.groups.add(group)
    await enqueue(groupTask(group.group_id, 'create', { group_id: group.group_id, name, ord: group.ord }))
    await load()

    return group
  }

  async function rename(groupId: string, name: string) {
    await db.groups.update(groupId, { name, update_time: Date.now() })
    await enqueue(groupTask(groupId, 'prop', { name }))
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

  return { groups, load, create, rename, remove }
})
