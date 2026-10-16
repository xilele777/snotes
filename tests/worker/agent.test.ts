import { beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { agentContract } from '../agent-contract'
import { api, resetDb } from './helpers'
beforeEach(resetDb)
agentContract(async (path, method = 'GET', body, token, extraHeaders) => api(path, {
  method, headers: extraHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}, token), () => env)
