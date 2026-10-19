import { afterEach, expect, it, vi } from 'vitest'
import { collectMetrics, collectCache } from '../../worker/metrics/collect'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); collectCache.clear() })

it('seven-day charts still use the full month for monthly operations and daily peaks', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 19, 12))
  collectCache.clear()
  const days = Array.from({ length: 19 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { viewer: { accounts: [{
    r2OperationsAdaptiveGroups: days.map(date => ({ dimensions: { datetime: date + 'T12:00:00Z', actionType: 'PutObject' }, sum: { requests: 100 } })),
    r2StorageAdaptiveGroups: [],
    d1AnalyticsAdaptiveGroups: days.map((date, i) => ({ dimensions: { date }, sum: { rowsRead: i === 0 ? 6_000_000 : 1, rowsWritten: 0, readQueries: 1, writeQueries: 0, queryBatchTimeMs: 0 } })),
    workersInvocationsAdaptive: [],
  }] } } }), { headers: { 'Content-Type': 'application/json' } })))
  const result = await collectMetrics({ accountId: 'test-month', apiToken: 'fixture', r2BucketName: 'test', d1DatabaseId: 'test' })
  expect(result.quota.monthDays).toBe(19)
  expect(result.quota.items.find(item => item.label.includes('Class A'))?.used).toBe(1900)
  expect(result.quota.items.find(item => item.label.includes('D1 行读取'))?.used).toBe(6_000_000)
  expect(result.d1?.trend).toHaveLength(7)
})
