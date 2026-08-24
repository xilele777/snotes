import type { MetricsData } from '../../shared/types'
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
  const creds: CfCredentials = { accountId: ctx.accountId, apiToken: ctx.apiToken }

  // 三元判别会因闭包失掉对可选字段的收窄，先取到局部再断言
  const d1DatabaseId = ctx.d1DatabaseId
  const r2BucketName = ctx.r2BucketName
  const zoneId = ctx.zoneId

  const d1 = d1DatabaseId ? await safe(() => collectD1(creds, d1DatabaseId!, days)) : null

  const r2 = r2BucketName ? await safe(() => collectR2(creds, r2BucketName, days)) : null

  // HTTP 是可选指标：没配 CF_ZONE_ID 或账号没有 zone 权限，卡片显示「无权限」而非整页失败
  const http = zoneId ? await safe(() => collectHttp(creds, zoneId, days)) : { error: 'no_permission' as const }

  return { d1, r2, http }
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
