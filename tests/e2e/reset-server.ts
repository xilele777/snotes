import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const TABLES = ['note_body', 'image', 'note', 'note_group'] as const

/** 清空本地 D1。必须在每个用例开始前调用，否则用例之间会通过服务端互相污染。 */
export function resetServer(): void {
  // note_body 与 image 排在 note 前面：它们对 note 有外键，删除顺序反了会被约束挡住。
  const sql = TABLES.map((t) => `DELETE FROM ${t};`).join(' ')

  execFileSync(process.execPath, [
    resolve('node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'snotes-e2e', '--local',
    '--config', 'tests/e2e/wrangler.jsonc',
    '--persist-to', 'tmp/e2e-state', '--command', sql,
  ], { stdio: 'pipe' })
}
