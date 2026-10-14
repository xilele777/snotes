import { beforeEach } from 'vitest'
import { knowledgeBaseContract } from '../knowledge-base-contract'
import { api, resetDb } from './helpers'
beforeEach(resetDb)
knowledgeBaseContract(async (path, method, body) => api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
