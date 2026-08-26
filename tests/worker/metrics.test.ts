import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../worker/app'
import { collectMetrics } from '../../worker/metrics/collect'
import {
  extractD1Usage,
  extractR2Operations,
  extractR2Storage,
  extractWorkersUsage,
  gql,
} from '../../worker/metrics/graphql'

const OK = { Authorization: 'Bearer test-token' }

describe('POST /api/metrics/types', () => {
  it('未配置 CF_ACCOUNT_ID / CF_API_TOKEN 时返回 503 与 not_configured', async () => {
    const app = createApp()

    const res = await app.request('/api/metrics/types', { method: 'POST', headers: OK }, env)

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'not_configured' })
  })
})

describe('extractD1Usage', () => {
  it('按天聚合读/写行数、SQL 次数与平均耗时', () => {
    const days = ['2026-08-23', '2026-08-24']
    const data = {
      viewer: {
        accounts: [
          {
            d1AnalyticsAdaptiveGroups: [
              { dimensions: { date: '2026-08-23' }, sum: { rowsRead: 100, rowsWritten: 20, readQueries: 10, writeQueries: 2, queryBatchTimeMs: 60_000 } },
              { dimensions: { date: '2026-08-24' }, sum: { rowsRead: 1, rowsWritten: 9, readQueries: 5, writeQueries: 5, queryBatchTimeMs: 5_000 } },
            ],
          },
        ],
      },
    }

    const usage = extractD1Usage(data, days)!

    expect(usage.readsToday).toBe(1)
    expect(usage.writesToday).toBe(9)
    expect(usage.sqlToday).toBe(10)
    expect(usage.avgMs).toBe(500)
    expect(usage.trend[0]).toEqual({ date: '2026-08-23', reads: 100, writes: 20, sql: 12, avgMs: 5_000 })
    expect(usage.trend[1]).toEqual({ date: '2026-08-24', reads: 1, writes: 9, sql: 10, avgMs: 500 })
  })

  it('成功响应没有行数据时返回零用量', () => {
    const usage = extractD1Usage({ viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [] }] } }, ['2026-08-24'])
    expect(usage?.readsToday).toBe(0)
    expect(usage?.writesToday).toBe(0)
    expect(usage?.trend[0]).toEqual({ date: '2026-08-24', reads: 0, writes: 0, sql: 0, avgMs: 0 })
  })
})

describe('extractR2Storage', () => {
  it('取最新快照的对象数与存储量', () => {
    const data = {
      viewer: {
        accounts: [
          { r2StorageAdaptiveGroups: [{ dimensions: { datetime: '2026-08-24T12:00:00Z' }, max: { objectCount: 3, payloadSize: 1024 } }] },
        ],
      },
    }

    expect(extractR2Storage(data)).toEqual({ objects: 3, bytes: 1024 })
  })

  it('没有行数据返回零快照', () => {
    expect(extractR2Storage({ viewer: { accounts: [{ r2StorageAdaptiveGroups: [] }] } })).toEqual({ objects: 0, bytes: 0 })
  })
})

describe('extractR2Operations', () => {
  it('按 actionType 归类 Class A / Class B 并按天聚合', () => {
    const days = ['2026-08-24']
    const data = {
      viewer: {
        accounts: [
          {
            r2OperationsAdaptiveGroups: [
              { dimensions: { datetime: '2026-08-24T10:00:00Z', actionType: 'PutObject' }, sum: { requests: 4 } },
              { dimensions: { datetime: '2026-08-24T11:00:00Z', actionType: 'GetObject' }, sum: { requests: 6 } },
              { dimensions: { datetime: '2026-08-24T12:00:00Z', actionType: 'PutObject' }, sum: { requests: 1 } },
            ],
          },
        ],
      },
    }

    const ops = extractR2Operations(data, days)!

    expect(ops.classAToday).toBe(5)
    expect(ops.classBToday).toBe(6)
    expect(ops.trend[0]).toEqual({ date: '2026-08-24', classA: 5, classB: 6 })
  })

  it('成功响应没有行数据时返回零操作', () => {
    const ops = extractR2Operations({ viewer: { accounts: [{ r2OperationsAdaptiveGroups: [] }] } }, ['2026-08-24'])
    expect(ops).toEqual({ classAToday: 0, classBToday: 0, trend: [{ date: '2026-08-24', classA: 0, classB: 0 }] })
  })
})

describe('extractWorkersUsage', () => {
  it('聚合账号级 Workers 每日请求数', () => {
    const days = ['2026-08-24']
    const data = {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptiveGroups: [
              { dimensions: { datetime: '2026-08-24T10:00:00Z' }, sum: { requests: 4 } },
              { dimensions: { datetime: '2026-08-24T11:00:00Z' }, sum: { requests: 3 } },
            ],
          },
        ],
      },
    }

    expect(extractWorkersUsage(data, days)).toEqual({
      requestsToday: 7,
      trend: [{ date: '2026-08-24', requests: 7 }],
    })
  })

  it('没有行数据返回零请求', () => {
    expect(extractWorkersUsage({ viewer: { accounts: [{ workersInvocationsAdaptiveGroups: [] }] } }, ['2026-08-24'])).toEqual({
      requestsToday: 0,
      trend: [{ date: '2026-08-24', requests: 0 }],
    })
  })
})

describe('gql', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('HTTP 非 2xx 抛 GraphqlError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))

    await expect(gql({ accountId: 'a', apiToken: 't' }, 'query {}', {})).rejects.toThrow('graphql http 500')
  })

  it('GraphQL errors 数组抛出其中 message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: 'unauthorized' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    await expect(gql({ accountId: 'a', apiToken: 't' }, 'query {}', {})).rejects.toThrow('unauthorized')
  })

  it('请求头带 Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { viewer: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await gql({ accountId: 'a', apiToken: 'secret' }, 'query {}', {})

    // workerd 里 fetch 的 headers 参数是普通对象，不是 Headers 实例
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer secret')
  })
})

describe('collectMetrics', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('一次聚合月度用量：趋势、存储与额度使用同一份数据', async () => {
    const days = [new Date().toISOString().slice(0, 10)]
    const today = days[0]!

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const { query } = JSON.parse(String(init?.body)) as { query: string }
        const ok = (data: unknown) =>
          new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })

        if (query.includes('d1AnalyticsAdaptiveGroups')) {
          return ok({
            viewer: {
              accounts: [
                {
                  d1AnalyticsAdaptiveGroups: [
                    { dimensions: { date: today }, sum: { rowsRead: 100, rowsWritten: 20, readQueries: 10, writeQueries: 2, queryBatchTimeMs: 60_000 } },
                  ],
                },
              ],
            },
          })
        }
        if (query.includes('r2StorageAdaptiveGroups')) {
          return ok({
            viewer: {
              accounts: [
                { r2StorageAdaptiveGroups: [{ dimensions: { datetime: `${today}T12:00:00Z` }, max: { objectCount: 3, payloadSize: 1024 } }] },
              ],
            },
          })
        }
        if (query.includes('r2OperationsAdaptiveGroups')) {
          return ok({
            viewer: {
              accounts: [
                {
                  r2OperationsAdaptiveGroups: [
                    { dimensions: { datetime: `${today}T10:00:00Z`, actionType: 'PutObject' }, sum: { requests: 4 } },
                    { dimensions: { datetime: `${today}T11:00:00Z`, actionType: 'GetObject' }, sum: { requests: 6 } },
                  ],
                },
              ],
            },
          })
        }
        if (query.includes('workersInvocationsAdaptiveGroups')) {
          return ok({
            viewer: {
              accounts: [
                {
                  workersInvocationsAdaptiveGroups: [
                    { dimensions: { datetime: `${today}T10:00:00Z` }, sum: { requests: 80 } },
                  ],
                },
              ],
            },
          })
        }
        return ok({ viewer: {} })
      })
    )

    const result = await collectMetrics({
      accountId: 'acct',
      apiToken: 'token',
      d1DatabaseId: 'd1',
      r2BucketName: 'bucket',
    })

    expect(result.d1?.readsToday).toBe(100)
    expect(result.d1?.writesToday).toBe(20)
    expect(result.d1?.sqlToday).toBe(12)
    expect(result.d1?.avgMs).toBe(5_000)
    expect(result.r2?.objects).toBe(3)
    expect(result.r2?.bytes).toBe(1024)
    expect(result.r2?.classAToday).toBe(4)
    expect(result.r2?.classBToday).toBe(6)
    expect(result.workers?.requestsToday).toBe(80)
    expect(result.quota.items.find((item) => item.label.startsWith('Workers'))).toMatchObject({
      used: 80,
      limit: 100_000,
      status: 'safe',
      available: true,
    })
  })

  it('D1 查询失败时 d1 为 null，R2 照常返回', async () => {
    const today = new Date().toISOString().slice(0, 10)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const { query } = JSON.parse(String(init?.body)) as { query: string }
        const ok = (data: unknown) =>
          new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })

        if (query.includes('d1AnalyticsAdaptiveGroups')) return new Response('boom', { status: 500 })
        if (query.includes('r2StorageAdaptiveGroups')) {
          return ok({
            viewer: {
              accounts: [
                { r2StorageAdaptiveGroups: [{ dimensions: { datetime: `${today}T12:00:00Z` }, max: { objectCount: 1, payloadSize: 1 } }] },
              ],
            },
          })
        }
        if (query.includes('r2OperationsAdaptiveGroups')) {
          return ok({
            viewer: {
              accounts: [
                {
                  r2OperationsAdaptiveGroups: [
                    { dimensions: { datetime: `${today}T10:00:00Z`, actionType: 'PutObject' }, sum: { requests: 1 } },
                  ],
                },
              ],
            },
          })
        }
        return ok({ viewer: {} })
      })
    )

    const result = await collectMetrics({
      accountId: 'acct',
      apiToken: 'token',
      d1DatabaseId: 'd1',
      r2BucketName: 'bucket',
    })

    expect(result.d1).toBeNull()
    expect(result.quota.items.filter((item) => item.status === 'unavailable')).toHaveLength(2)
    expect(result.r2).not.toBeNull()
  })
})
