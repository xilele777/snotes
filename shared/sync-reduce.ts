// shared/sync-reduce.ts —— pull 结果归约（规格 §8.1 步骤 4）
import type { LocalNoteState, NoteMeta, PullPlan } from './types'

export function planPull(remote: NoteMeta[], local: Map<string, LocalNoteState>): PullPlan {
  const plan: PullPlan = { insert: [], updateProp: [], fetchBody: [] }

  for (const note of remote) {
    const current = local.get(note.id)

    if (!current) {
      plan.insert.push(note)
      plan.fetchBody.push(note.id)
      continue
    }

    if (note.prop_version > current.prop_version) {
      plan.updateProp.push(note)
    }

    // 比的是 body_version（本地这份正文对应哪个服务端版本），不是 version。
    // 插入时 version 已继承远端而 body 还是空的，用 version 比会让「正文没拉到」
    // 这个状态永远修不回来。
    //
    // body_pending 为真说明本地正文还没推上去，此时拿远端正文覆盖会直接吞掉
    // 用户离线写的内容，而且走不到冲突副本那条路——先让 push 去和服务端解冲突。
    if (note.version > current.body_version && !current.body_pending) {
      plan.fetchBody.push(note.id)
    }
  }

  return plan
}
