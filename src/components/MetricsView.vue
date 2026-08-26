<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { MetricsData, MetricsTrendPoint, QuotaItem, QuotaStatus } from '../../shared/types'
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
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : String(error)
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

function fmt(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value))
}

function fmtBytes(value: number): string {
  if (value >= 1e9) return (value / 1e9).toFixed(2) + ' GB'
  if (value >= 1e6) return (value / 1e6).toFixed(2) + ' MB'
  if (value >= 1e3) return (value / 1e3).toFixed(1) + ' KB'
  return Math.round(value) + ' B'
}

function fmtQuota(item: QuotaItem): string {
  return item.unit === 'GB' ? fmtBytes(item.used) : fmt(item.used)
}

function fmtLimit(item: QuotaItem): string {
  return item.unit === 'GB' ? fmtBytes(item.limit) : fmt(item.limit)
}

function fmtPercent(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Number(value.toFixed(1))
  return `${rounded}%`
}

function fmtDay(day: string): string {
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`
}

const quota = computed(() => data.value?.quota ?? null)

const summary = computed(() => {
  const item = quota.value
  if (!item) return null
  const unavailableCount = item.items.filter((entry) => entry.status === 'unavailable').length
  const titles: Record<QuotaStatus, string> = {
    safe: '未超出免费额度',
    warning: '接近免费额度',
    over: '已超出免费额度',
    unavailable: '部分额度无法确认',
  }
  const descriptions: Record<QuotaStatus, string> = {
    safe: '当前周期内的已知用量都在 Cloudflare 免费额度内。',
    warning: '有指标已达到免费额度的 80%，建议关注增长趋势。',
    over: '至少一项用量已超过 Cloudflare 免费额度，可能产生费用。',
    unavailable: '部分 Analytics 数据查询失败，暂时不能确认全部额度状态。',
  }
  return { title: titles[item.status], description: descriptions[item.status], unavailableCount }
})

const statusLabel: Record<QuotaStatus, string> = {
  safe: '安全',
  warning: '接近上限',
  over: '已超出',
  unavailable: '无法判断',
}

const cycleLabel: Record<QuotaItem['cycle'], string> = {
  daily: '每日额度',
  monthly: '自然月额度',
  snapshot: '当前快照',
}

interface TrendSeries {
  field: string
  label: string
  color: string
}

interface TrendChart {
  key: string
  title: string
  points: MetricsTrendPoint[]
  series: TrendSeries[]
  max: number
}

function maxOf(points: MetricsTrendPoint[], fields: string[]): number {
  return Math.max(1, ...points.flatMap((point) => fields.map((field) => (point[field] as number) ?? 0)))
}

const charts = computed<TrendChart[]>(() => {
  const metrics = data.value
  if (!metrics) return []
  const result: TrendChart[] = []

  if (metrics.d1) {
    result.push({
      key: 'd1',
      title: 'D1 · 每日读写行数',
      points: metrics.d1.trend,
      series: [
        { field: 'reads', label: '读行', color: '#3692f5' },
        { field: 'writes', label: '写行', color: '#fed634' },
      ],
      max: maxOf(metrics.d1.trend, ['reads', 'writes']),
    })
  }

  if (metrics.r2) {
    result.push({
      key: 'r2',
      title: 'R2 · 每日操作数',
      points: metrics.r2.trend,
      series: [
        { field: 'classA', label: 'Class A', color: '#3692f5' },
        { field: 'classB', label: 'Class B', color: '#ffac00' },
      ],
      max: maxOf(metrics.r2.trend, ['classA', 'classB']),
    })
  }

  if (metrics.workers) {
    result.push({
      key: 'workers',
      title: 'Workers · 每日请求',
      points: metrics.workers.trend,
      series: [{ field: 'requests', label: '请求', color: '#5e7a88' }],
      max: maxOf(metrics.workers.trend, ['requests']),
    })
  }

  return result
})
</script>

<template>
  <div class="metrics-view usage-view">
    <div class="metrics-topbar">
      <div class="metrics-title">
        <span class="header-title">用量监控</span>
        <span v-if="status === 'ready'" class="metrics-sub">Cloudflare 免费额度 · UTC 自然月</span>
      </div>
      <button class="metrics-refresh" title="刷新" aria-label="刷新" @click="load">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
        </svg>
      </button>
    </div>

    <div class="metrics-body">
      <p v-if="status === 'loading'" class="metrics-hint">正在读取 Cloudflare Analytics…</p>

      <div v-else-if="status === 'error'" class="metrics-error">
        <p>监控数据获取失败：{{ errorMsg }}</p>
        <button class="metrics-retry" @click="load">重试</button>
      </div>

      <template v-else-if="data && summary && quota">
        <section class="quota-hero" :data-status="quota.status">
          <div class="hero-copy">
            <span class="hero-kicker">免费额度判定</span>
            <h4 class="hero-title">{{ summary.title }}</h4>
            <p class="hero-description">{{ summary.description }}</p>
          </div>
          <div class="hero-badges">
            <span v-if="quota.overCount > 0" class="hero-badge danger">{{ quota.overCount }} 项超出</span>
            <span v-if="quota.warningCount > 0" class="hero-badge warning">{{ quota.warningCount }} 项接近</span>
            <span v-if="summary.unavailableCount > 0" class="hero-badge muted">{{ summary.unavailableCount }} 项未知</span>
            <span class="hero-badge plain">本月已过 {{ quota.monthDays }} 天</span>
          </div>
        </section>

        <section class="quota-grid">
          <article
            v-for="item in quota.items"
            :key="item.label"
            class="quota-card"
            :data-status="item.status"
          >
            <header class="quota-card-head">
              <div>
                <span class="quota-cycle">{{ cycleLabel[item.cycle] }}</span>
                <h5 class="quota-name">{{ item.label }}</h5>
              </div>
              <span class="status-pill">{{ statusLabel[item.status] }}</span>
            </header>

            <div class="quota-percent-row">
              <strong class="quota-percent">{{ item.available ? fmtPercent(item.percent) : '—' }}</strong>
              <span class="quota-used">{{ item.available ? `${fmtQuota(item)} / ${fmtLimit(item)}` : `上限 ${fmtLimit(item)}` }}</span>
            </div>

            <div class="quota-track">
              <div class="quota-fill" :style="{ width: Math.min(100, item.percent) + '%' }"></div>
              <i class="quota-warning-mark"></i>
            </div>

            <dl class="quota-detail">
              <div v-if="item.secondaryLabel">
                <dt>{{ item.secondaryLabel }}</dt>
                <dd>{{ item.unit === 'GB' ? fmtBytes(item.secondaryValue ?? 0) : fmt(item.secondaryValue ?? 0) }}</dd>
              </div>
              <div v-if="item.peakDate">
                <dt>最高日期</dt>
                <dd>{{ fmtDay(item.peakDate) }}</dd>
              </div>
            </dl>
            <p class="quota-explanation">{{ item.explanation }}</p>
          </article>
        </section>

        <details class="trend-panel">
          <summary>
            <span>查看近 7 天明细</span>
            <small>趋势只用于定位用量来源；超额判定以上方官方周期口径为准。</small>
          </summary>

          <div v-if="charts.length" class="metric-cards">
            <div v-if="data.d1" class="metric-card">
              <h4 class="card-title">D1 今日</h4>
              <dl class="card-list">
                <div><dt>读 / 写行</dt><dd>{{ fmt(data.d1.readsToday) }} / {{ fmt(data.d1.writesToday) }}</dd></div>
                <div><dt>SQL 次数</dt><dd>{{ fmt(data.d1.sqlToday) }}</dd></div>
                <div><dt>平均耗时</dt><dd>{{ data.d1.avgMs }} ms</dd></div>
              </dl>
            </div>
            <div v-if="data.r2" class="metric-card">
              <h4 class="card-title">R2 当前</h4>
              <dl class="card-list">
                <div><dt>存储 / 对象</dt><dd>{{ fmtBytes(data.r2.bytes) }} / {{ fmt(data.r2.objects) }}</dd></div>
                <div><dt>A / B 操作今日</dt><dd>{{ fmt(data.r2.classAToday) }} / {{ fmt(data.r2.classBToday) }}</dd></div>
              </dl>
            </div>
            <div v-if="data.workers" class="metric-card">
              <h4 class="card-title">Workers 账号级</h4>
              <dl class="card-list">
                <div><dt>今日请求</dt><dd>{{ fmt(data.workers.requestsToday) }}</dd></div>
              </dl>
            </div>
          </div>

          <div v-if="charts.length" class="metric-charts">
            <div v-for="chart in charts" :key="chart.key" class="chart-block">
              <div class="chart-head">
                <h4 class="chart-title">{{ chart.title }}</h4>
                <span class="chart-total">近 7 天</span>
              </div>
              <div class="bar-chart">
                <div v-for="point in chart.points" :key="point.date" class="bar-col">
                  <div class="bar-stack">
                    <div
                      v-for="series in chart.series"
                      :key="series.field"
                      class="bar"
                      :style="{ height: (((point[series.field] as number) ?? 0) / chart.max * 100) + '%', background: series.color }"
                      :title="`${fmtDay(point.date)} ${series.label} ${fmt((point[series.field] as number) ?? 0)}`"
                    />
                  </div>
                  <span class="bar-day">{{ fmtDay(point.date) }}</span>
                </div>
                <div class="bar-legend">
                  <span v-for="series in chart.series" :key="series.field" class="legend-item">
                    <i :style="{ background: series.color }"></i>
                    {{ series.label }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="metrics-hint">暂无可用趋势数据。</p>
        </details>
      </template>
    </div>
  </div>
</template>
