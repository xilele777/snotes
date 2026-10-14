// shared/home-feed.ts —— 「首页信息流」可见性规则（纯函数，前后端共用）
//
// 首页信息流 = 「全部笔记」视图。默认所有笔记都在里面，两级设置可以把它摘出去：
//   1. 分组级 hide_from_home：加进这个分组的笔记默认不上首页；
//   2. 笔记级 home_hidden：0 / 1 强制显示 / 隐藏，null（或缺失）跟随分组。
// 笔记级优先，所以「分组整体不上首页」之后，个别笔记仍能单独放回首页。
import type { NoteMeta } from './types'

/** 判定只需要用到分组这两个字段，避免把整行都拖进来。 */
export interface HomeFeedGroup {
  group_id: string
  hide_from_home?: 0 | 1
}

/** 收集所有「默认不上首页」的分组 id，供列表过滤与统计复用。 */
export function homeHiddenGroupIds(groups: readonly HomeFeedGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.hide_from_home === 1).map((g) => g.group_id))
}

/**
 * 一条笔记是否不出现在首页信息流。
 * home_hidden 是三态覆盖：1 隐藏、0 显示、null / undefined 跟随所在分组。
 * 未分组笔记没有分组默认值可跟随，缺失 home_hidden 时一律显示。
 */
export function isHiddenFromHome(
  note: Pick<NoteMeta, 'home_hidden' | 'group_id'>,
  hiddenGroups: ReadonlySet<string>
): boolean {
  if (note.home_hidden === 1) return true
  if (note.home_hidden === 0) return false
  return note.group_id !== null && note.group_id !== undefined && hiddenGroups.has(note.group_id)
}
