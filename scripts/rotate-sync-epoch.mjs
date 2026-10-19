import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Explicit config is mandatory: never silently target the production Worker.
const [config, ...rest] = process.argv.slice(2)
if (!config || rest.length > 1 || rest.length === 1 && rest[0] !== '--strict-enabled') {
  console.error('Usage (during maintenance): node scripts/rotate-sync-epoch.mjs PATH_TO_WRANGLER_CONFIG')
  process.exitCode = 1
} else {
  const epoch = randomUUID()
  const strict = rest[0] === '--strict-enabled' ? { status: 0, error: null } : spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', 'SYNC_REQUIRE_EPOCH', '--config', resolve(config)], { input: 'true', encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] })
  if (strict.error) throw strict.error
  if (strict.status !== 0) process.exit(strict.status ?? 1)
  const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', 'SYNC_INSTANCE_EPOCH', '--config', resolve(config)], { input: epoch, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
  if (!process.exitCode) console.log(`Recovery epoch: ${epoch}`)
}
