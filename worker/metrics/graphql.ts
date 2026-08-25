import type { D1Usage, HttpUsage, MetricsTrendPoint } from '../../shared/types'

/**
 * CF GraphQL Analytics 标准查询层（Bug 8）。
 * 每个指标一个「query 构建器 + data 提取器」函数对：构建器给出查询文本与变量，
 * 提取器把响应里的 AdaptiveGroups 行聚合成界面直接可用的结构。
 * 提取器是纯函数，单测里喂假 data 即可，不碰网络。
 *
 * 端点用官方 /client/v4/graphql（不是 /graphql）：
 * https://developers.cloudflare.com/analytics/graphql-api/
 */
export const CF_GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'

export interface CfCredentials {
  accountId: string
  apiToken: string
}

export class GraphqlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphqlError'
  }
}

export async function gql(
  credentials: CfCredentials,
  query: string,
  variables: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(CF_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) throw new GraphqlError(`graphql http ${res.status}`)

  const payload = (await res.json()) as {
    data?: Record<string, unknown>
    errors?: { message: string }[]
  }
  if (payload.errors?.length) {
    throw new GraphqlError(payload.errors.map((e) => e.message).join('; '))
  }
  return payload.data ?? {}
}

/** 取 viewer.accounts 下某个归一化后的指标节点的行数组（缺省返回 []） */
function accountRows(
  data: Record<string, unknown>,
  node: string
): Array<Record<string, any>> {
  const viewer = data.viewer as { accounts?: Array<Record<string, unknown>> } | undefined
  const account = viewer?.accounts?.[0] as Record<string, unknown> | undefined
  const rows = account?.[node]
  return Array.isArray(rows) ? (rows as Array<Record<string, any>>) : []
}

/* === 工具 === */

/** UTC 日期键，如 2026-08-24 */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** 最近 n 天（含今天），升序，最后一个是今天 */
export function lastNDays(n: number, now = Date.now()): string[] {
  const days: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    days.push(dayKey(now - i * 86_400_000))
  }
  return days
}
/** 当月至今（含今天）的 UTC 日期键数组，升序。用于按计费月聚合用量。 */
export function monthToDateDays(now = Date.now()): string[] {
  const d = new Date(now)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  const days: string[] = []
  for (let t = start; t <= now; t += 86_400_000) {
    days.push(dayKey(t))
  }
  return days
}

/* === D1 === */

export const D1_QUERY = /* GraphQL */ `
  query D1Metrics($accountTag: String!, $databaseId: String!, $date_geq: String!, $date_leq: String!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $date_geq, date_leq: $date_leq, databaseId: $databaseId }
          orderBy: [date_ASC]
        ) {
          dimensions { date }
          sum { rowsRead rowsWritten readQueries writeQueries queryBatchTimeMs }
        }
      }
    }
  }
`

export function buildD1Query(
  accountTag: string,
  databaseId: string,
  days: string[]
): { query: string; variables: Record<string, unknown> } {
  return {
    query: D1_QUERY,
    variables: { accountTag, databaseId, date_geq: days[0], date_leq: days[days.length - 1] },
  }
}

interface D1DayAgg {
  rowsRead: number
  rowsWritten: number
  readQueries: number
  writeQueries: number
  queryBatchTimeMs: number
}

const D1_ZERO: D1DayAgg = {
  rowsRead: 0,
  rowsWritten: 0,
  readQueries: 0,
  writeQueries: 0,
  queryBatchTimeMs: 0,
}

export function extractD1Usage(data: Record<string, unknown>, days: string[]): D1Usage | null {
  const rows = accountRows(data, 'd1AnalyticsAdaptiveGroups')
  if (rows.length === 0) return null

  const byDay = new Map<string, D1DayAgg>()
  for (const row of rows) {
    const date = row.dimensions?.date as string | undefined
    if (!date) continue
    const s = (row.sum ?? {}) as Partial<D1DayAgg>
    const prev = byDay.get(date) ?? { ...D1_ZERO }
    byDay.set(date, {
      rowsRead: prev.rowsRead + (s.rowsRead ?? 0),
      rowsWritten: prev.rowsWritten + (s.rowsWritten ?? 0),
      readQueries: prev.readQueries + (s.readQueries ?? 0),
      writeQueries: prev.writeQueries + (s.writeQueries ?? 0),
      queryBatchTimeMs: prev.queryBatchTimeMs + (s.queryBatchTimeMs ?? 0),
    })
  }

  const trend: MetricsTrendPoint[] = days.map((date) => {
    const v = byDay.get(date) ?? { ...D1_ZERO }
    const count = v.readQueries + v.writeQueries
    return {
      date,
      reads: v.rowsRead,
      writes: v.rowsWritten,
      sql: count,
      avgMs: count > 0 ? Math.round(v.queryBatchTimeMs / count) : 0,
    }
  })

  const today = byDay.get(days[days.length - 1]) ?? { ...D1_ZERO }
  const todayCount = today.readQueries + today.writeQueries
  return {
    readsToday: today.rowsRead,
    writesToday: today.rowsWritten,
    sqlToday: todayCount,
    avgMs: todayCount > 0 ? Math.round(today.queryBatchTimeMs / todayCount) : 0,
    trend,
  }
}

/* === R2 存储：最新快照的 对象数 / 存储量 === */

export const R2_STORAGE_QUERY = /* GraphQL */ `
  query R2Storage($accountTag: String!, $bucketName: String!, $datetime_geq: String!, $datetime_leq: String!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        r2StorageAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: $datetime_geq, datetime_leq: $datetime_leq, bucketName: $bucketName }
          orderBy: [datetime_DESC]
        ) {
          dimensions { datetime }
          max { objectCount payloadSize }
        }
      }
    }
  }
`

export function buildR2StorageQuery(accountTag: string, bucketName: string, days: string[]) {
  const to = days[days.length - 1]
  return {
    query: R2_STORAGE_QUERY,
    variables: {
      accountTag,
      bucketName,
      datetime_geq: `${days[0]}T00:00:00Z`,
      datetime_leq: `${to}T23:59:59.999Z`,
    },
  }
}

export function extractR2Storage(data: Record<string, unknown>): { objects: number; bytes: number } | null {
  const rows = accountRows(data, 'r2StorageAdaptiveGroups')
  if (rows.length === 0) return null
  const max = (rows[0].max ?? {}) as { objectCount?: number; payloadSize?: number }
  return { objects: max.objectCount ?? 0, bytes: max.payloadSize ?? 0 }
}

/* === R2 操作数：Class A / Class B（按 actionType 归类） === */

/** 从定价分类（https://developers.cloudflare.com/r2/pricing/）转录 */
const CLASS_A_ACTIONS = new Set([
  'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject',
  'CompleteMultipartUpload', 'CreateMultipartUpload', 'LifecycleStorageTierTransition',
  'ListMultipartUploads', 'UploadPart', 'UploadPartCopy', 'ListParts',
  'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration',
])

const CLASS_B_ACTIONS = new Set([
  'HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary',
  'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration',
])

export const R2_OPERATIONS_QUERY = /* GraphQL */ `
  query R2Operations($accountTag: String!, $bucketName: String!, $datetime_geq: String!, $datetime_leq: String!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        r2OperationsAdaptiveGroups(
          limit: 10000
          filter: { datetime_geq: $datetime_geq, datetime_leq: $datetime_leq, bucketName: $bucketName }
          orderBy: [datetime_ASC]
        ) {
          dimensions { actionType datetime }
          sum { requests }
        }
      }
    }
  }
`

export function buildR2OperationsQuery(accountTag: string, bucketName: string, days: string[]) {
  const to = days[days.length - 1]
  return {
    query: R2_OPERATIONS_QUERY,
    variables: {
      accountTag,
      bucketName,
      datetime_geq: `${days[0]}T00:00:00Z`,
      datetime_leq: `${to}T23:59:59.999Z`,
    },
  }
}

function classify(actionType: string): 'classA' | 'classB' | 'other' {
  if (CLASS_A_ACTIONS.has(actionType)) return 'classA'
  if (CLASS_B_ACTIONS.has(actionType)) return 'classB'
  return 'other'
}

interface R2OpDay {
  classA: number
  classB: number
}

export function extractR2Operations(
  data: Record<string, unknown>,
  days: string[]
): { classAToday: number; classBToday: number; trend: MetricsTrendPoint[] } | null {
  const rows = accountRows(data, 'r2OperationsAdaptiveGroups')
  if (rows.length === 0) return null

  const byDay = new Map<string, R2OpDay>()
  for (const row of rows) {
    const date = row.dimensions?.datetime as string | undefined
    if (!date) continue
    const actionType = (row.dimensions?.actionType ?? '') as string
    const requests = ((row.sum ?? {}).requests ?? 0) as number
    const key = date.slice(0, 10) // datetime 带时刻，按天聚合
    const prev = byDay.get(key) ?? { classA: 0, classB: 0 }
    if (classify(actionType) === 'classA') prev.classA += requests
    else if (classify(actionType) === 'classB') prev.classB += requests
    byDay.set(key, prev)
  }

  const trend: MetricsTrendPoint[] = days.map((date) => {
    const v = byDay.get(date) ?? { classA: 0, classB: 0 }
    return { date, classA: v.classA, classB: v.classB }
  })

  const today = byDay.get(days[days.length - 1]) ?? { classA: 0, classB: 0 }
  return { classAToday: today.classA, classBToday: today.classB, trend }
}

/* === HTTP 请求量（可选：需要 CF_ZONE_ID） === */

export const HTTP_QUERY = /* GraphQL */ `
  query HttpMetrics($zoneTag: String!, $date_geq: String!, $date_leq: String!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        httpRequests1dGroups(
          limit: 31
          filter: { date_geq: $date_geq, date_leq: $date_leq }
          orderBy: [date_ASC]
        ) {
          dimensions { date }
          sum { requests }
        }
      }
    }
  }
`

export function buildHttpQuery(zoneTag: string, days: string[]) {
  return {
    query: HTTP_QUERY,
    variables: { zoneTag, date_geq: days[0], date_leq: days[days.length - 1] },
  }
}

export function extractHttpUsage(data: Record<string, unknown>, days: string[]): HttpUsage | null {
  const viewer = data.viewer as { zones?: Array<Record<string, unknown>> } | undefined
  const rows = viewer?.zones?.[0]?.httpRequests1dGroups
  const list = Array.isArray(rows) ? (rows as Array<Record<string, any>>) : []
  if (list.length === 0) return null

  const byDay = new Map<string, number>()
  for (const row of list) {
    const date = row.dimensions?.date as string | undefined
    if (!date) continue
    byDay.set(date, (byDay.get(date) ?? 0) + ((row.sum?.requests as number) ?? 0))
  }

  const trend: MetricsTrendPoint[] = days.map((date) => ({
    date,
    requests: byDay.get(date) ?? 0,
  }))

  return { requestsToday: trend[trend.length - 1].requests as number, trend }
}
