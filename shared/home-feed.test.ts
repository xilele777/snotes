import { describe, expect, it } from 'vitest'
import { homeHiddenGroupIds, isHiddenFromHome } from './home-feed'

const groups = [
  { group_id: 'g1', hide_from_home: 1 as const },
  { group_id: 'g2', hide_from_home: 0 as const },
  { group_id: 'g3' },
]

describe('homeHiddenGroupIds', () => {
  it('只收 hide_from_home === 1 的分组', () => {
    expect([...homeHiddenGroupIds(groups)]).toEqual(['g1'])
  })

  it('没有分组时不返回任何 id', () => {
    expect(homeHiddenGroupIds([]).size).toBe(0)
  })
})

describe('isHiddenFromHome', () => {
  const hidden = homeHiddenGroupIds(groups)

  it('笔记级 home_hidden=1 覆盖分组默认，无分组也隐藏', () => {
    expect(isHiddenFromHome({ group_id: 'g2', home_hidden: 1 }, hidden)).toBe(true)
    expect(isHiddenFromHome({ group_id: null, home_hidden: 1 }, hidden)).toBe(true)
  })

  it('笔记级 home_hidden=0 把分组里默认隐藏的笔记放回首页', () => {
    expect(isHiddenFromHome({ group_id: 'g1', home_hidden: 0 }, hidden)).toBe(false)
  })

  it('home_hidden 为 null / 缺失时跟随分组', () => {
    expect(isHiddenFromHome({ group_id: 'g1', home_hidden: null }, hidden)).toBe(true)
    expect(isHiddenFromHome({ group_id: 'g1' }, hidden)).toBe(true)
    expect(isHiddenFromHome({ group_id: 'g2', home_hidden: null }, hidden)).toBe(false)
  })

  it('未分组笔记跟随不到任何默认值，一律显示', () => {
    expect(isHiddenFromHome({ group_id: null, home_hidden: null }, hidden)).toBe(false)
    expect(isHiddenFromHome({ group_id: null }, hidden)).toBe(false)
  })
})
