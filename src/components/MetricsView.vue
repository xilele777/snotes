<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { MetricsData, MetricsTrendPoint } from '../../shared/types'
import { apiMetrics } from '../api/client'
import type { MetricsErrorResponse, MetricsResponse } from '../api/client'

type Status = 'loading' | 'error' | 'ready'

const status = ref<Status>('loading')
const errorMsg = ref('')
const data = ref<MetricsData | null>(null)

async function load() {
  status.value = 'loading'

  let res: MetricsResponse | MetricsErrorResponse | null
  try {
    res = await apiMetrics()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
    return
  }

  if (!res || !('data' in res)) {
    status.value = 'error'
    errorMsg.value = res && 'message' in res ? res.message ?? '加载失败，请稍后重试' : '加载失败，请稍后重试'
    return
  }

  data.value = res.data
  status.value = 'ready'
}

onMounted(load)

function fmt(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(n))
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB'
  return Math.round(n) + ' B'
}

function dayLabel(day: string): string {
  return Number(day.slice(5, 7)) + '/' + Number(day.slice(8))
}

function trendPct(today: number, yesterday: number): string | null {
  if (yesterday === 0) return today > 0 ? '+新增' : null
  const v = ((today - yesterday) / yesterday) * 100
  const sign = v >= 0 ? '+' : ''
  return sign + v.toFixed(1) + '%'
}

function barTip(date: string, label: string, value: number): string {
  return date + ' ' + label + ': ' + fmt(value)
}

interface Insight {
  text: string
  tone: 'up' | 'down' | 'flat' | 'info'
}

const insights = computed<Insight[]>(() => {
  const d = data.value
  if (!d) return []
  const list: Insight[] = []

  if (d.d1 && d.d1.trend.length >= 2) {
    const t = d.d1.trend
    const reads = t.map((p) => (p.reads as number) ?? 0)
    const today = reads[reads.length - 1]
    const y = reads[reads.length - 2]
    const pct = trendPct(today, y)
    if (pct) list.push({ text: 'D1 读行数今日 ' + pct.replace(/^[+-]/, '') + ' vs 昨日', tone: today >= y ? 'up' : 'down' })
    const avgMs = d.d1.avgMs ?? 0
    if (avgMs > 0) list.push({ text: 'D1 今日平均查询耗时 ' + avgMs + ' ms', tone: 'info' })
  }

  if (d.r2 && d.r2.trend.length >= 2) {
    const t = d.r2.trend
    const sumA = t.reduce((s, p) => s + ((p.classA as number) ?? 0), 0)
    const sumB = t.reduce((s, p) => s + ((p.classB as number) ?? 0), 0)
    const total = sumA + sumB
    if (total > 0) {
      const aRatio = (sumA / total) * 100
      list.push({ text: 'R2 近 7 天 Class A 占比 ' + aRatio.toFixed(0) + '%（计费操作）', tone: aRatio > 50 ? 'up' : 'info' })
    }
    list.push({ text: 'R2 存储 ' + fmtBytes(d.r2.bytes) + ' / ' + fmt(d.r2.objects) + ' 个对象', tone: 'info' })
  }

  if (d.http && !('error' in d.http) && d.http.trend.length >= 2) {
    const t = d.http.trend
    const reqs = t.map((p) => (p.requests as number) ?? 0)
    const today = reqs[reqs.length - 1]
    const y = reqs[reqs.length - 2]
    const pct = trendPct(today, y)
    if (pct) list.push({ text: 'HTTP 请求量今日 ' + pct.replace(/^[+-]/, '') + ' vs 昨日', tone: today >= y ? 'up' : 'down' })
  }

  return list
})

interface ChartSeries {
  field: string
  label: string
  color: string
}
interface TrendChart {
  title: string
  total: number
  points: MetricsTrendPoint[]
  series: ChartSeries[]
  max: number
  peak: { value: number; date: string } | null
}

function maxOf(points: MetricsTrendPoint[], fields: string[]): number {
  return Math.max(1, ...points.flatMap((p) => fields.map((f) => (p[f] as number) ?? 0)))
}

function barHeight(value: number, max: number): string {
  return (value / max) * 100 + '%'
}

function dayTotal(points: MetricsTrendPoint[], fields: string[]): number {
  return points.reduce((s, p) => s + fields.reduce((a, f) => a + ((p[f] as number) ?? 0), 0), 0)
}

const charts = computed<TrendChart[]>(() => {
  const d = data.value
  if (!d) return []
  const list: TrendChart[] = []

  if (d.d1) {
    const series = [
      { field: 'reads', label: '读', color: '#3692f5' },
      { field: 'writes', label: '写', color: '#fed634' },
    ]
    const points = d.d1.trend
    const fields = ['reads', 'writes']
    list.push({ title: 'D1 近 7 天 · 读 / 写行数', total: dayTotal(points, fields), points, series, max: maxOf(points, fields), peak: findPeak(points, fields) })
  }

  if (d.r2) {
    const series = [
      { field: 'classA', label: 'Class A', color: '#3692f5' },
      { field: 'classB', label: 'Class B', color: '#ffac00' },
    ]
    const points = d.r2.trend
    const fields = ['classA', 'classB']
    list.push({ title: 'R2 近 7 天 · Class A / B 操作数', total: dayTotal(points, fields), points, series, max: maxOf(points, fields), peak: findPeak(points, fields) })
  }

  if (d.http && !('error' in d.http)) {
    const series = [{ field: 'requests', label: '请求', color: '#5e7a88' }]
    const points = d.http.trend
    const fields = ['requests']
    list.push({ title: 'HTTP 近 7 天 · 请求量', total: dayTotal(points, fields), points, series, max: maxOf(points, fields), peak: findPeak(points, fields) })
  }

  return list
})

function findPeak(points: MetricsTrendPoint[], fields: string[]): { value: number; date: string } | null {
  let peak: { value: number; date: string } | null = null
  for (const p of points) {
    const v = fields.reduce((a, f) => a + ((p[f] as number) ?? 0), 0)
    if (!peak || v > peak.value) peak = { value: v, date: p.date }
  }
  return peak
}

interface OverviewStat {
  label: string
  value: string
  sub?: string
  tone: 'up' | 'down' | 'flat' | 'info'
}
const overview = computed<OverviewStat[]>(() => {
  const d = data.value
  if (!d) return []
  const stats: OverviewStat[] = []

  if (d.d1 && d.d1.trend.length >= 2) {
    const t = d.d1.trend
    const reads = t.map((p) => (p.reads as number) ?? 0)
    const total = reads.reduce((s, v) => s + v, 0)
    const today = reads[reads.length - 1]
    const y = reads[reads.length - 2]
    const pct = trendPct(today, y)
    stats.push({ label: 'D1 读行数 · 7天', value: fmt(total), sub: pct ? '今日 ' + pct : '今日 ' + fmt(today), tone: today >= y ? 'up' : 'down' })
    const writes = t.map((p) => (p.writes as number) ?? 0)
    const wTotal = writes.reduce((s, v) => s + v, 0)
    stats.push({ label: 'D1 写行数 · 7天', value: fmt(wTotal), sub: '今日 ' + fmt(writes[writes.length - 1]), tone: 'info' })
    stats.push({ label: 'D1 今日 SQL', value: fmt(d.d1.sqlToday), sub: d.d1.avgMs + ' ms/次', tone: 'info' })
  }

  if (d.r2 && d.r2.trend.length >= 1) {
    const t = d.r2.trend
    const total = t.reduce((s, p) => s + ((p.classA as number) ?? 0) + ((p.classB as number) ?? 0), 0)
    stats.push({ label: 'R2 操作数 · 7天', value: fmt(total), sub: 'A ' + fmt(d.r2.classAToday) + ' / B ' + fmt(d.r2.classBToday), tone: 'info' })
    stats.push({ label: 'R2 存储', value: fmtBytes(d.r2.bytes), sub: fmt(d.r2.objects) + ' 个对象', tone: 'info' })
  }

  if (d.http && !('error' in d.http) && d.http.trend.length >= 2) {
    const t = d.http.trend
    const reqs = t.map((p) => (p.requests as number) ?? 0)
    const total = reqs.reduce((s, v) => s + v, 0)
    const today = reqs[reqs.length - 1]
    const y = reqs[reqs.length - 2]
    const pct = trendPct(today, y)
    stats.push({ label: 'HTTP 请求 · 7天', value: fmt(total), sub: pct ? '今日 ' + pct : '今日 ' + fmt(today), tone: today >= y ? 'up' : 'down' })
  }

  return stats
})

interface QuotaBar {
  label: string
  usedText: string
  limitText: string
  pct: number
  status: 'safe' | 'warn' | 'over'
  over: boolean
}

function fmtQuota(used: number, unit: string): string {
  if (unit === 'GB') {
    if (used >= 1e9) return (used / 1e9).toFixed(2) + ' GB'
    if (used >= 1e6) return (used / 1e6).toFixed(2) + ' MB'
    return (used / 1e3).toFixed(1) + ' KB'
  }
  return fmt(used)
}

const quotaBars = computed<QuotaBar[]>(() => {
  const d = data.value
  if (!d || !d.quota) return []
  return d.quota.items.map((it) => {
    const ratio = it.limit > 0 ? it.used / it.limit : 0
    const pct = Math.min(100, Math.round(ratio * 100))
    const over = it.used > it.limit
    const status: QuotaBar['status'] = over ? 'over' : ratio >= 0.8 ? 'warn' : 'safe'
    return {
      label: it.label,
      usedText: fmtQuota(it.used, it.unit),
      limitText: fmtQuota(it.limit, it.unit),
      pct,
      status,
      over,
    }
  })
})

const quotaMonthDays = computed(() => data.value?.quota?.monthDays ?? 0)
const quotaOverCount = computed(() => quotaBars.value.filter((b) => b.over).length)
</script>

<template>
  <div class="metrics-view">
    <div class="metrics-topbar">
      <div class="metrics-title">
        <span class="header-title">数据监控</span>
        <span v-if="status === 'ready'" class="metrics-sub">Cloudflare D1 · R2 · HTTP 近 7 天</span>
      </div>
      <button class="metrics-refresh" title="刷新" aria-label="刷新" @click="load">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
        </svg>
      </button>
    </div>

    <div class="metrics-body">
      <p v-if="status === 'loading'" class="metrics-hint">加载中…</p>

      <div v-else-if="status === 'error'" class="metrics-error">
        <p>监控数据获取失败：{{ errorMsg }}</p>
        <button class="metrics-retry" @click="load">重试</button>
      </div>

      <template v-else-if="data">
        <section v-if="overview.length" class="metrics-overview">
          <div v-for="s in overview" :key="s.label" class="ov-card" :data-tone="s.tone">
            <span class="ov-label">{{ s.label }}</span>
            <span class="ov-value">{{ s.value }}</span>
            <span v-if="s.sub" class="ov-sub">{{ s.sub }}</span>
          </div>
        </section>

        <section v-if="quotaBars.length" class="metrics-quota">
          <div class="quota-head">
            <h4 class="quota-title">免费额度用量</h4>
            <span class="quota-meta">当月已过 {{ quotaMonthDays }} 天
              <span v-if="quotaOverCount > 0" class="quota-alert">{{ quotaOverCount }} 项已超费</span>
            </span>
          </div>
          <ul class="quota-list">
            <li v-for="q in quotaBars" :key="q.label" class="quota-item" :data-status="q.status">
              <div class="quota-row">
                <span class="quota-name">{{ q.label }}</span>
                <span class="quota-nums">{{ q.usedText }} / {{ q.limitText }}
                  <i v-if="q.over" class="quota-flag">超费</i>
                </span>
              </div>
              <div class="quota-track">
                <div class="quota-fill" :style="{ width: q.pct + '%' }"></div>
              </div>
              <span class="quota-pct">{{ q.pct }}%</span>
            </li>
          </ul>
        </section>

        <section v-if="insights.length" class="metrics-insights">
          <h4 class="insights-title">趋势洞察</h4>
          <ul class="insights-list">
            <li v-for="(it, i) in insights" :key="i" class="insight-item" :data-tone="it.tone">
              <i class="insight-dot"></i>{{ it.text }}
            </li>
          </ul>
        </section>

        <section class="metric-cards">
          <div class="metric-card">
            <h4 class="card-title">D1 数据库 · 今日</h4>
            <dl v-if="data.d1" class="card-list">
              <div><dt>读行数</dt><dd>{{ fmt(data.d1.readsToday) }}</dd></div>
              <div><dt>写行数</dt><dd>{{ fmt(data.d1.writesToday) }}</dd></div>
              <div><dt>SQL 次数</dt><dd>{{ fmt(data.d1.sqlToday) }}</dd></div>
              <div><dt>平均耗时</dt><dd>{{ data.d1.avgMs }} ms</dd></div>
            </dl>
            <p v-else class="card-empty">暂无数据</p>
          </div>

          <div class="metric-card">
            <h4 class="card-title">R2 存储</h4>
            <dl v-if="data.r2" class="card-list">
              <div><dt>存储量</dt><dd>{{ fmtBytes(data.r2.bytes) }}</dd></div>
              <div><dt>对象数</dt><dd>{{ fmt(data.r2.objects) }}</dd></div>
              <div><dt>Class A · 今日</dt><dd>{{ fmt(data.r2.classAToday) }}</dd></div>
              <div><dt>Class B · 今日</dt><dd>{{ fmt(data.r2.classBToday) }}</dd></div>
            </dl>
            <p v-else class="card-empty">暂无数据</p>
          </div>

          <div class="metric-card">
            <h4 class="card-title">HTTP 请求量</h4>
            <dl v-if="data.http && !('error' in data.http)" class="card-list">
              <div><dt>今日请求</dt><dd>{{ fmt(data.http.requestsToday) }}</dd></div>
            </dl>
            <p v-else class="card-empty">
              {{ data.http && 'error' in data.http ? '无权限（未配置 CF_ZONE_ID）' : '未启用' }}
            </p>
          </div>
        </section>

        <section v-if="charts.length" class="metric-charts">
          <div v-for="chart in charts" :key="chart.title" class="chart-block">
            <div class="chart-head">
              <h4 class="chart-title">{{ chart.title }}</h4>
              <span class="chart-total">7 天合计 {{ fmt(chart.total) }}</span>
            </div>
            <div class="bar-chart">
              <div v-for="p in chart.points" :key="p.date" class="bar-col">
                <div class="bar-stack">
                  <div
                    v-for="s in chart.series"
                    :key="s.field"
                    class="bar"
                    :style="{ height: barHeight((p[s.field] as number) ?? 0, chart.max), background: s.color }"
                    :title="barTip(p.date, s.label, (p[s.field] as number) ?? 0)"
                  />
                </div>
                <span class="bar-day">{{ dayLabel(p.date) }}</span>
              </div>
              <div class="bar-legend">
                <span v-for="s in chart.series" :key="s.field" class="legend-item">
                  <i :style="{ background: s.color }"></i>
                  {{ s.label }}
                </span>
              </div>
            </div>
            <p v-if="chart.peak" class="chart-peak">峰值 {{ fmt(chart.peak.value) }}（{{ dayLabel(chart.peak.date) }}）</p>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
