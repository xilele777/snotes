import { describe, expect, it } from 'vitest'
import type { LocalNoteState, NoteMeta } from './types'
import { planPull } from './sync-reduce'

const note = (over: Partial<NoteMeta> = {}): NoteMeta => ({
  id: 'n1',
  group_id: null,
  title: 't',
  summary: 's',
  thumbnail: null,
  version: 1,
  prop_version: 1,
  star: 0,
  top: 0,
  skin_color: null,
  invalid: 0,
  create_time: 1,
  update_time: 1,
  ...over,
})

const state = (over: Partial<LocalNoteState> & { id: string }): LocalNoteState => ({
  version: 1,
  body_version: 1,
  prop_version: 1,
  body_pending: false,
  ...over,
})

const localMap = (...items: LocalNoteState[]) => new Map(items.map((i) => [i.id, i]))

describe('planPull', () => {
  it('本地不存在则插入，并把正文列入待拉', () => {
    const plan = planPull([note({ id: 'a' })], new Map())

    expect(plan.insert.map((n) => n.id)).toEqual(['a'])
    expect(plan.fetchBody).toEqual(['a'])
    expect(plan.updateProp).toEqual([])
  })

  it('远端 prop_version 更高则更新属性', () => {
    const plan = planPull(
      [note({ id: 'a', version: 1, prop_version: 5 })],
      localMap(state({ id: 'a', version: 1, body_version: 1, prop_version: 3 }))
    )

    expect(plan.updateProp.map((n) => n.id)).toEqual(['a'])
    expect(plan.fetchBody).toEqual([])
    expect(plan.insert).toEqual([])
  })

  it('远端 version 高于本地 body_version 则列入待拉正文', () => {
    const plan = planPull(
      [note({ id: 'a', version: 9, prop_version: 1 })],
      localMap(state({ id: 'a', version: 4, body_version: 4, prop_version: 1 }))
    )

    expect(plan.fetchBody).toEqual(['a'])
    expect(plan.updateProp).toEqual([])
  })

  it('两个版本都更高则同时更新属性并拉正文', () => {
    const plan = planPull(
      [note({ id: 'a', version: 9, prop_version: 9 })],
      localMap(state({ id: 'a', version: 1, body_version: 1, prop_version: 1 }))
    )

    expect(plan.updateProp.map((n) => n.id)).toEqual(['a'])
    expect(plan.fetchBody).toEqual(['a'])
  })

  it('版本都不更高则完全忽略——这就是重复 pull 的幂等性', () => {
    const local = localMap(state({ id: 'a', version: 5, body_version: 5, prop_version: 5 }))
    const remote = [note({ id: 'a', version: 5, prop_version: 5 })]

    const first = planPull(remote, local)
    const second = planPull(remote, local)

    expect(first).toEqual({ insert: [], updateProp: [], fetchBody: [] })
    expect(second).toEqual(first)
  })

  it('本地版本高于远端时也忽略，不回退本地未推送的修改', () => {
    const plan = planPull(
      [note({ id: 'a', version: 2, prop_version: 2 })],
      localMap(state({ id: 'a', version: 7, body_version: 7, prop_version: 7 }))
    )

    expect(plan).toEqual({ insert: [], updateProp: [], fetchBody: [] })
  })

  it('已插入但正文没拉到的笔记（body_version=0），下一轮会重新列入待拉', () => {
    // 上一轮：远端 version=5 的笔记插入本地，version 继承为 5 供 base_version 用，
    // 但正文批次失败，body_version 仍是 0。
    const plan = planPull(
      [note({ id: 'a', version: 5, prop_version: 1 })],
      localMap(state({ id: 'a', version: 5, body_version: 0, prop_version: 1 }))
    )

    expect(plan.fetchBody).toEqual(['a'])
    expect(plan.updateProp).toEqual([])
  })

  it('本地有待推送的正文修改时不拉远端正文，交给 push 去解冲突', () => {
    const plan = planPull(
      [note({ id: 'a', version: 9, prop_version: 1 })],
      localMap(state({ id: 'a', version: 1, body_version: 1, prop_version: 1, body_pending: true }))
    )

    expect(plan.fetchBody).toEqual([])
  })

  it('待推送正文不影响属性更新——改星标和改正文互不相干', () => {
    const plan = planPull(
      [note({ id: 'a', version: 9, prop_version: 9 })],
      localMap(state({ id: 'a', version: 1, body_version: 1, prop_version: 1, body_pending: true }))
    )

    expect(plan.updateProp.map((n) => n.id)).toEqual(['a'])
    expect(plan.fetchBody).toEqual([])
  })

  it('回收站笔记照常参与归约，不做特殊处理', () => {
    const plan = planPull(
      [note({ id: 'a', invalid: 1, prop_version: 2 })],
      localMap(state({ id: 'a', version: 1, body_version: 1, prop_version: 1 }))
    )

    expect(plan.updateProp[0].invalid).toBe(1)
  })

  it('混合批次各归其位', () => {
    const plan = planPull(
      [
        note({ id: 'new' }),
        note({ id: 'prop', prop_version: 3 }),
        note({ id: 'body', version: 3 }),
        note({ id: 'same' }),
      ],
      localMap(
        state({ id: 'prop' }),
        state({ id: 'body' }),
        state({ id: 'same' })
      )
    )

    expect(plan.insert.map((n) => n.id)).toEqual(['new'])
    expect(plan.updateProp.map((n) => n.id)).toEqual(['prop'])
    expect(plan.fetchBody.sort()).toEqual(['body', 'new'])
  })
})
