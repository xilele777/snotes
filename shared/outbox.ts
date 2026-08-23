// shared/outbox.ts —— outbox 任务合并（规格 §8.2）
import type { OutboxTask } from './types'

export function mergeTask(existing: OutboxTask | undefined, incoming: OutboxTask): OutboxTask {
  return {
    ...incoming,
    id: existing?.id,
    // 新编辑立即可发，且清掉上一次的失败标记
    retry: 0,
    next_at: 0,
    failed: 0,
    // 单调递增，push 用它判断「我发出去的那一版是否已被新编辑取代」
    seq: (existing?.seq ?? 0) + 1,
  }
}
