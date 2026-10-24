import { defineStore } from 'pinia'
import { ref } from 'vue'
import Dexie from 'dexie'
import type { Group, OutboxTask } from '../../shared/types'
import { db } from '../db/schema'
import { enqueue } from '../db/repo'

/** 分组上可以直接修改并同步到服务端的字段（PATCH /api/groups/:id 接受的几项） */
export type GroupPatch = Partial<Pick<Group, 'name' | 'color' | 'ord' | 'hide_from_home'>>

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
  async function create(name: string, options: { color?: string | null; hide_from_home?: 0 | 1 } = {}) {
    const group: Group = {
      group_id: crypto.randomUUID(),
      name,
      ord: groups.value.length,
      color: options.color ?? null,
      hide_from_home: options.hide_from_home ?? 0,
      invalid: 0,
      update_time: Date.now(),
    }

    await db.transaction('rw', db.groups, db.outbox, async () => {
      await db.groups.add(group)
      await enqueue(groupTask(group.group_id, 'create', {
        group_id: group.group_id, name, ord: group.ord, color: group.color, hide_from_home: group.hide_from_home,
      }))
    })
    // Imports own the surrounding transaction and refresh only after commit.
    if (!Dexie.currentTransaction) await load()

    return group
  }

  /**
   * 同一分组连续改多个属性（先改名再改色）要累积成一个 payload：
   * mergeTask 只保留最新 payload，不合并的话先改的那项在推送时就丢了。
   * 事务内部用：读旧 payload 与写入必须同事务，调用方的 db.transaction 需包含 db.outbox。
   */
  async function enqueuePropIn(groupId: string, changes: GroupPatch) {
    const existing = await db.outbox.where('[note_id+kind]').equals([groupId, 'prop']).first()
    const previous = (existing?.payload as Record<string, unknown> | undefined) ?? {}
    await enqueue(groupTask(groupId, 'prop', { ...previous, ...changes }))
  }

  async function patch(groupId: string, changes: GroupPatch) {
    // 写库与入队同一个事务（与 repo.ts 的笔记操作同款约束）：任一步失败整体回滚，
    // 否则崩溃窗口内「本地已改但永不同步」——分组没有 dirty 标记，无法自愈。
    await db.transaction('rw', db.groups, db.outbox, async () => {
      await db.groups.update(groupId, { ...changes, update_time: Date.now() })
      await enqueuePropIn(groupId, changes)
    })
    await load()
  }

  const rename = (groupId: string, name: string) => patch(groupId, { name })

  const setColor = (groupId: string, color: string | null) => patch(groupId, { color })

  /**
   * 组内笔记是否默认不上首页信息流。只改分组这一位：
   * 组内笔记的 home_hidden 保持 null（跟随），开关一翻立刻整体跟着变；
   * 想让某条笔记例外，在那条笔记上单独设 home_hidden 就行。
   */
  const setHomeFeedHidden = (groupId: string, hidden: boolean) =>
    patch(groupId, { hide_from_home: hidden ? 1 : 0 })

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
    await db.transaction('rw', db.groups, db.outbox, async () => {
      await Promise.all(changed.map(({ group, ord }) => db.groups.update(group.group_id, { ord, update_time: now })))
      for (const { group, ord } of changed) await enqueuePropIn(group.group_id, { ord })
    })
    await load()
  }

  async function remove(groupId: string) {
    await db.transaction('rw', db.groups, db.notes, db.outbox, async () => {
      await db.groups.update(groupId, { invalid: 1, update_time: Date.now() })
      // 组内笔记回到未分组（规格 §7.3），不级联删除笔记
      await db.notes.where('group_id').equals(groupId).modify({ group_id: null })
      await enqueue(groupTask(groupId, 'trash', {}))
    })
    await load()
  }

  return { groups, load, create, rename, setColor, setHomeFeedHidden, move, remove }
})
