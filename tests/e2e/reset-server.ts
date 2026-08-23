import { execSync } from 'node:child_process'

const TABLES = ['note_body', 'image', 'note', 'note_group'] as const

/** 清空本地 D1。必须在每个用例开始前调用，否则用例之间会通过服务端互相污染。 */
export function resetServer(): void {
  // note_body 与 image 排在 note 前面：它们对 note 有外键，删除顺序反了会被约束挡住。
  const sql = TABLES.map((t) => `DELETE FROM ${t};`).join(' ')

  execSync(`npx wrangler d1 execute snotes --local --command "${sql}"`, {
    stdio: 'pipe',
  })
}
