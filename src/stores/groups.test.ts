import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/schema'
import { useGroupsStore } from './groups'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

const propTasks = (groupId: string) => db.outbox.where('[note_id+kind]').equals([groupId, 'prop']).toArray()

describe('groups store 属性修改', () => {
  it('setColor 写库并入队带 color 的分组 prop 任务', async () => {
    const store = useGroupsStore()
    const g = await store.create('工作')

    await store.setColor(g.group_id, '#cb8585')

    expect((await db.groups.get(g.group_id))!.color).toBe('#cb8585')
    expect(store.groups[0].color).toBe('#cb8585')
    const tasks = await propTasks(g.group_id)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].payload).toEqual({ scope: 'group', color: '#cb8585' })
  })

  it('先改名再改色只留一条 prop 任务，且两个字段都在 payload 里', async () => {
    const store = useGroupsStore()
    const g = await store.create('旧名')

    await store.rename(g.group_id, '新名')
    await store.setColor(g.group_id, '#86a394')
    await store.setColor(g.group_id, null)

    const tasks = await propTasks(g.group_id)
    expect(tasks).toHaveLength(1)
    // 少了 name，推送时服务端只收到颜色，改名就丢了
    expect(tasks[0].payload).toEqual({ scope: 'group', name: '新名', color: null })
  })
})

describe('groups store 排序', () => {
  it('move 交换相邻两项的 ord，并只为改动的分组入队 ord', async () => {
    const store = useGroupsStore()
    const a = await store.create('甲')
    const b = await store.create('乙')
    const c = await store.create('丙')

    await store.move(c.group_id, -1)

    expect(store.groups.map((g) => g.name)).toEqual(['甲', '丙', '乙'])
    expect((await db.groups.get(b.group_id))!.ord).toBe(2)
    expect((await db.groups.get(c.group_id))!.ord).toBe(1)
    expect(await propTasks(a.group_id)).toHaveLength(0)
    expect((await propTasks(b.group_id))[0].payload).toEqual({ scope: 'group', ord: 2 })
    expect((await propTasks(c.group_id))[0].payload).toEqual({ scope: 'group', ord: 1 })
  })

  it('已在顶端上移或已在末尾下移时什么都不做', async () => {
    const store = useGroupsStore()
    const a = await store.create('甲')
    const b = await store.create('乙')

    await store.move(a.group_id, -1)
    await store.move(b.group_id, 1)

    expect(store.groups.map((g) => g.name)).toEqual(['甲', '乙'])
    expect(await propTasks(a.group_id)).toHaveLength(0)
    expect(await propTasks(b.group_id)).toHaveLength(0)
  })

  it('旧数据 ord 全为 0 时，move 顺手把整列归一成 0..n-1', async () => {
    const store = useGroupsStore()
    const now = Date.now()
    for (const [id, name] of [['g1', '一'], ['g2', '二'], ['g3', '三']] as const) {
      await db.groups.add({ group_id: id, name, ord: 0, color: null, invalid: 0, update_time: now })
    }
    await store.load()
    expect(store.groups.map((g) => g.name)).toEqual(['一', '二', '三'])

    await store.move('g3', -1)

    expect(store.groups.map((g) => g.name)).toEqual(['一', '三', '二'])
    expect((await db.groups.get('g1'))!.ord).toBe(0)
    expect((await db.groups.get('g3'))!.ord).toBe(1)
    expect((await db.groups.get('g2'))!.ord).toBe(2)
  })
})
