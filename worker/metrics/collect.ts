import type { MetricsData, QuotaItem } from '../../shared/types'
import {
  buildD1Query,
  buildHttpQuery,
  buildR2OperationsQuery,
  buildR2StorageQuery,
  extractD1Usage,
  extractHttpUsage,
  extractR2Operations,
  extractR2Storage,
  gql,
  lastNDays,
  monthToDateDays,
} from './graphql'
import type { CfCredentials } from './graphql'

/**
 * 监控页数据采集（Bug 8）。三个区块各自的失败只影响自己：
 * D1/R2 查询失败给 null（前端该卡片显示错误态），HTTP 缺 zone 或失败给 error。
 * 不能让单个区段把整页监控拖垮。
 */
export interface MetricsContext {
  accountId: string
  apiToken: string
  d1DatabaseId?: string
  r2BucketName?: string
  zoneId?: string
}

export async function collectMetrics(ctx: MetricsContext): Promise<MetricsData> {
  const days = lastNDays(7)
  const monthDays = monthToDateDays()
  const creds: CfCredentials = { accountId: ctx.accountId, apiToken: ctx.apiToken }

  // 三元判别会因闭包失掉对可选字段的收窄，先取到局部再断言
  const d1DatabaseId = ctx.d1DatabaseId
  const r2BucketName = ctx.r2BucketName
  const zoneId = ctx.zoneId

  const d1 = d1DatabaseId ? await safe(() => collectD1(creds, d1DatabaseId!, days)) : null

  const r2 = r2BucketName ? await safe(() => collectR2(creds, r2BucketName, days)) : null

  // HTTP 是可选指标：没配 CF_ZONE_ID 或账号没有 zone 权限，卡片显示「无权限」而非整页失败
  const http = zoneId ? await safe(() => collectHttp(creds, zoneId, days)) : { error: 'no_permission' as const }

  // 当月用量 vs 免费额度：另起一次「当月至今」聚合，单独失败不影响上面的趋势/卡片
  const quota = await safe(() => collectQuota(creds, ctx, monthDays)).then((q) => q ?? { monthDays: monthDays.length, items: [] })

  return { d1, r2, http, quota }
}

async function safe<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch {
    return null
  }
}

async function collectD1(creds: CfCredentials, databaseId: string, days: string[]) {
  const { query, variables } = buildD1Query(creds.accountId, databaseId, days)
  const data = await gql(creds, query, variables)
  return extractD1Usage(data, days)
}

async function collectR2(creds: CfCredentials, bucketName: string, days: string[]) {
  const storage = await (async () => {
    try {
      const { query, variables } = buildR2StorageQuery(creds.accountId, bucketName, days)
      return extractR2Storage(await gql(creds, query, variables))
    } catch {
      return null
    }
  })()

  const ops = await (async () => {
    try {
      const { query, variables } = buildR2OperationsQuery(creds.accountId, bucketName, days)
      return extractR2Operations(await gql(creds, query, variables), days)
    } catch {
      return null
    }
  })()

  // 存储或操作任一查不出来，说明 bucket 还没产生任何指标
  if (!storage || !ops) return null

  return {
    ...storage,
    classAToday: ops.classAToday,
    classBToday: ops.classBToday,
    trend: ops.trend,
  }
}

async function collectHttp(creds: CfCredentials, zoneId: string, days: string[]) {
  const { query, variables } = buildHttpQuery(zoneId, days)
  const data = await gql(creds, query, variables)
  return extractHttpUsage(data, days) ?? { error: 'no_permission' as const }
}

/* === 当月用量 vs 免费额度 ===
 * Cloudflare 免费额度（值会随官方政策变动，集中在这里便于维护）：
 *   D1  行读取 5,000,000/天、行写入 100,000/天（免费版按天计，故对照「当天」用量）
 *   R2  Class A 1,000,000/月、Class B 10,000,000/月、存储 10 GB
 *   Workers/HTTP 100,000 请求/天（免费版按天计）
 * R2 存储用最新快照而非当月累计；其余按当月聚合（D1/HTTP 是按天额度，对照当天峰值更合理）。
 */
const FREE_LIMITS = {
  D1_READS_PER_DAY: 5_000_000,
  D1_WRITES_PER_DAY: 100_000,
  R2_CLASS_A_PER_MONTH: 1_000_000,
  R2_CLASS_B_PER_MONTH: 10_000_000,
  R2_STORAGE_BYTES: 10 * 1e9,
  HTTP_REQUESTS_PER_DAY: 100_000,
}

async function collectQuota(creds: CfCredentials, ctx: MetricsContext, monthDays: string[]): Promise<{ monthDays: number; items: QuotaItem[] }> {
  const items: QuotaItem[] = []
  const d1DatabaseId = ctx.d1DatabaseId
  const r2BucketName = ctx.r2BucketName
  const zoneId = ctx.zoneId

  // D1：当月累计读/写，按天额度则对照「当天」
  if (d1DatabaseId) {
    try {
      const { query, variables } = buildD1Query(creds.accountId, d1DatabaseId, monthDays)
      const usage = extractD1Usage(await gql(creds, query, variables), monthDays)
      if (usage) {
        const monthReads = monthDays.reduce((s, d) => s + ((usage.trend.find((p) => p.date === d)?.reads as number) ?? 0), 0)
        const monthWrites = monthDays.reduce((s, d) => s + ((usage.trend.find((p) => p.date === d)?.writes as number) ?? 0), 0)
        items.push({ label: 'D1 行读取（当月）', used: monthReads, limit: FREE_LIMITS.D1_READS_PER_DAY * monthDays.length, unit: '行' })
        items.push({ label: 'D1 行写入（当月）', used: monthWrites, limit: FREE_LIMITS.D1_WRITES_PER_DAY * monthDays.length, unit: '行' })
      }
    } catch {
      // D1 用量查不到就跳过，不影响其他额度项
    }
  }

  // R2：当月 Class A/B 累计 + 存储快照
  if (r2BucketName) {
    try {
      const { query, variables } = buildR2OperationsQuery(creds.accountId, r2BucketName, monthDays)
      const ops = extractR2Operations(await gql(creds, query, variables), monthDays)
      if (ops) {
        const monthA = monthDays.reduce((s, d) => s + ((ops.trend.find((p) => p.date === d)?.classA as number) ?? 0), 0)
        const monthB = monthDays.reduce((s, d) => s + ((ops.trend.find((p) => p.date === d)?.classB as number) ?? 0), 0)
        items.push({ label: 'R2 Class A（当月）', used: monthA, limit: FREE_LIMITS.R2_CLASS_A_PER_MONTH, unit: '次' })
        items.push({ label: 'R2 Class B（当月）', used: monthB, limit: FREE_LIMITS.R2_CLASS_B_PER_MONTH, unit: '次' })
      }
    } catch {
      // 忽略
    }
    try {
      const { query, variables } = buildR2StorageQuery(creds.accountId, r2BucketName, [monthDays[monthDays.length - 1]])
      const storage = extractR2Storage(await gql(creds, query, variables))
      if (storage) {
        items.push({ label: 'R2 存储', used: storage.bytes, limit: FREE_LIMITS.R2_STORAGE_BYTES, unit: 'GB' })
      }
    } catch {
      // 忽略
    }
  }

  // HTTP：当月累计请求，按天额度对照当月（天数 × 10万）
  if (zoneId) {
    try {
      const { query, variables } = buildHttpQuery(zoneId, monthDays)
      const usage = extractHttpUsage(await gql(creds, query, variables), monthDays)
      if (usage && !('error' in usage)) {
        const monthReqs = monthDays.reduce((s, d) => s + ((usage.trend.find((p) => p.date === d)?.requests as number) ?? 0), 0)
        items.push({ label: 'HTTP 请求（当月）', used: monthReqs, limit: FREE_LIMITS.HTTP_REQUESTS_PER_DAY * monthDays.length, unit: '请求' })
      }
    } catch {
      // 忽略
    }
  }

  return { monthDays: monthDays.length, items }
}
