import { beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { syncCheckpointContract } from '../sync-checkpoint-contract'
import { json, resetDb } from './helpers'
beforeEach(resetDb)
syncCheckpointContract((path, body) => json(path, 'POST', body), () => env)
