import type { D1Usage, MetricsData, MetricsTrendPoint, QuotaItem, QuotaStatus, WorkersUsage } from '../../shared/types'
import {
  buildD1Query,
  buildR2OperationsQuery,
  buildR2StorageQuery,
  buildWorkersQuery,
  extractD1Usage,
  extractR2Operations,
  extractR2Storage,
  extractWorkersUsage,
  gql,
  monthToDateDays,
} from './graphql'
import type { CfCredentials } from './graphql'

export interface MetricsContext {
  accountId: string
  apiToken: string
  d1DatabaseId?: string
  r2BucketName?: string
}

/** Cloudflare 免费版额度。政策变化时只需要更新这里。 */
const FREE_LIMITS = {
  D1_READS_PER_DAY: 5_000_000,
  D1_WRITES_PER_DAY: 100_000,
  WORKERS_REQUESTS_PER_DAY: 100_000,
  R2_CLASS_A_PER_MONTH: 1_000_000,
  R2_CLASS_B_PER_MONTH: 10_000_000,
  R2_STORAGE_BYTES: 10 * 1e9,
}

/**
 * 一次拉取自然月至今的用量，前端趋势取最后 7 天。
 * 这比“趋势一次、额度再一次”少一半 Analytics 查询，也让额度和趋势使用同一份数据。
 */
export async function collectMetrics(ctx: MetricsContext): Promise<MetricsData> {
  const monthDays = monthToDateDays()
  const trendDays = monthDays.slice(-7)
  const creds: CfCredentials = { accountId: ctx.accountId, apiToken: ctx.apiToken }
  const d1DatabaseId = ctx.d1DatabaseId
  const r2BucketName = ctx.r2BucketName

  const [d1, r2Operations, r2Storage, workers] = await Promise.all([
    safe(() => {
      if (!d1DatabaseId) return Promise.resolve(null)
      const { query, variables } = buildD1Query(ctx.accountId, d1DatabaseId, monthDays)
      return gql(creds, query, variables).then((data) => {
        const usage = extractD1Usage(data, monthDays)
        return usage ? { ...usage, trend: usage.trend.slice(-trendDays.length) } : null
      })
    }),
    safe(() => {
      if (!r2BucketName) return Promise.resolve(null)
      const { query, variables } = buildR2OperationsQuery(ctx.accountId, r2BucketName, monthDays)
      return gql(creds, query, variables).then((data) => {
        const usage = extractR2Operations(data, monthDays)
        if (!usage) return null
        return { ...usage, trend: usage.trend.slice(-trendDays.length) }
      })
    }),
    safe(() => {
      if (!r2BucketName) return Promise.resolve(null)
      const day = monthDays[monthDays.length - 1]!
      const { query, variables } = buildR2StorageQuery(ctx.accountId, r2BucketName, [day])
      return gql(creds, query, variables).then((data) => extractR2Storage(data))
    }),
    safe(() => {
      const { query, variables } = buildWorkersQuery(ctx.accountId, monthDays)
      return gql(creds, query, variables).then((data) => {
        const usage = extractWorkersUsage(data, monthDays)
        return { ...usage, trend: usage.trend.slice(-trendDays.length) }
      })
    }),
  ])

  const quota = buildQuota({
    monthDays: monthDays.length,
    d1,
    r2Operations,
    r2Storage,
    workers,
  })

  return { d1, r2: combineR2(r2Operations, r2Storage), workers, quota }
}

async function safe<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch {
    return null
  }
}

function combineR2(
  operations: { classAToday: number; classBToday: number; trend: MetricsTrendPoint[] } | null,
  storage: { objects: number; bytes: number } | null
) {
  if (!operations || !storage) return null
  return {
    ...storage,
    classAToday: operations.classAToday,
    classBToday: operations.classBToday,
    trend: operations.trend,
  }
}

interface QuotaInput {
  monthDays: number
  d1: D1Usage | null
  r2Operations: { classAToday: number; classBToday: number; trend: MetricsTrendPoint[] } | null
  r2Storage: { objects: number; bytes: number } | null
  workers: WorkersUsage | null
}

function buildQuota(input: QuotaInput) {
  const items: QuotaItem[] = []
  const d1Values = input.d1?.trend ?? []
  const r2Values = input.r2Operations?.trend ?? []
  const workerValues = input.workers?.trend ?? []

  items.push(
    dailyQuotaItem('D1 行读取', d1Values, 'reads', FREE_LIMITS.D1_READS_PER_DAY, Boolean(input.d1)),
    dailyQuotaItem('D1 行写入', d1Values, 'writes', FREE_LIMITS.D1_WRITES_PER_DAY, Boolean(input.d1)),
    dailyQuotaItem('Workers 请求', workerValues, 'requests', FREE_LIMITS.WORKERS_REQUESTS_PER_DAY, Boolean(input.workers)),
    monthlyQuotaItem(
      'R2 Class A 操作',
      r2Values.map((point) => point.classA as number),
      FREE_LIMITS.R2_CLASS_A_PER_MONTH,
      Boolean(input.r2Operations),
      '次'
    ),
    monthlyQuotaItem(
      'R2 Class B 操作',
      r2Values.map((point) => point.classB as number),
      FREE_LIMITS.R2_CLASS_B_PER_MONTH,
      Boolean(input.r2Operations),
      '次'
    ),
    storageQuotaItem(input.r2Storage)
  )

  const overCount = items.filter((item) => item.status === 'over').length
  const warningCount = items.filter((item) => item.status === 'warning').length

  return {
    monthDays: input.monthDays,
    status: severityOf(items),
    overCount,
    warningCount,
    items,
  }
}

function dailyQuotaItem(
  label: string,
  points: MetricsTrendPoint[],
  field: string,
  limit: number,
  available: boolean
): QuotaItem {
  if (!available || points.length === 0) {
    return unavailableItem(`${label} · 本月最高单日`, limit, '行')
  }

  const values = points.map((point) => (point[field] as number) ?? 0)
  const today = values[values.length - 1]!
  let peakIndex = 0
  values.forEach((value, index) => {
    if (value > values[peakIndex]!) peakIndex = index
  })
  const used = values[peakIndex]!
  const percent = (used / limit) * 100
  const status = statusOf(percent)

  return {
    label: `${label} · 本月最高单日`,
    cycle: 'daily',
    used,
    limit,
    percent,
    status,
    secondaryLabel: '今日用量',
    secondaryValue: today,
    peakDate: points[peakIndex]!.date,
    explanation:
      status === 'over'
        ? '本月已有单日超过每日免费额度。'
        : status === 'warning'
          ? '已达到每日免费额度的 80%。'
          : '本月所有已知日期都在每日免费额度内。',
    available: true,
    unit: '行',
  }
}

function monthlyQuotaItem(
  label: string,
  values: number[],
  limit: number,
  available: boolean,
  unit: QuotaItem['unit']
): QuotaItem {
  if (!available) {
    return unavailableItem(`${label} · 当月累计`, limit, unit)
  }

  const used = values.reduce((sum, value) => sum + value, 0)
  const percent = (used / limit) * 100
  const status = statusOf(percent)

  return {
    label: `${label} · 当月累计`,
    cycle: 'monthly',
    used,
    limit,
    percent,
    status,
    secondaryLabel: '今日用量',
    secondaryValue: values[values.length - 1] ?? 0,
    explanation:
      status === 'over'
        ? '当月累计已超过免费额度。'
        : status === 'warning'
          ? '已达到当月免费额度的 80%。'
          : '仍在当月免费额度内。',
    available: true,
    unit,
  }
}

function storageQuotaItem(storage: { objects: number; bytes: number } | null): QuotaItem {
  if (!storage) {
    return unavailableItem('R2 存储 · 当前快照', FREE_LIMITS.R2_STORAGE_BYTES, 'GB')
  }

  const percent = (storage.bytes / FREE_LIMITS.R2_STORAGE_BYTES) * 100
  const status = statusOf(percent)
  return {
    label: 'R2 存储 · 当前快照',
    cycle: 'snapshot',
    used: storage.bytes,
    limit: FREE_LIMITS.R2_STORAGE_BYTES,
    percent,
    status,
    secondaryLabel: '对象数量',
    secondaryValue: storage.objects,
    explanation: '按最新存储快照预估；Cloudflare 账单通常按存储月均值计算。',
    available: true,
    unit: 'GB',
  }
}

function unavailableItem(label: string, limit: number, unit: QuotaItem['unit']): QuotaItem {
  return {
    label,
    cycle: 'snapshot',
    used: 0,
    limit,
    percent: 0,
    status: 'unavailable',
    explanation: 'Analytics 查询失败或数据暂不可用，无法判断是否超额。',
    available: false,
    unit,
  }
}

function statusOf(percent: number): Exclude<QuotaStatus, 'unavailable'> {
  if (percent > 100) return 'over'
  if (percent >= 80) return 'warning'
  return 'safe'
}

function severityOf(items: QuotaItem[]): QuotaStatus {
  if (items.some((item) => item.status === 'over')) return 'over'
  if (items.some((item) => item.status === 'warning')) return 'warning'
  if (items.some((item) => item.status === 'unavailable')) return 'unavailable'
  return 'safe'
}
