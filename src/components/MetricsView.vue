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
    // 网络层/鉴权异常：展示真实原因，而不是吞成一句通用文案
    errorMsg.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
    return
  }

  // 成功响应带 data，失败响应带 error/message，用 in 判别收窄联合类型
  if (!res || !('data' in res)) {
    status.value = 'error'
    errorMsg.value = res && 'message' in res ? res.message ?? '加载失败，请稍后重试' : '加载失败，请稍后重试'
    return
  }

  data.value = res.data
  status.value = 'ready'
}

onMounted(load)

/** 千分位整数 */
function fmt(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(n))
}

/** 存储量：B / KB / MB / GB */
function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${Math.round(n)} B`
}

/** 该系列里的最大值，用来把柱高归一化到 100% */
function maxOf(points: MetricsTrendPoint[], fields: string[]): number {
  return Math.max(1, ...points.flatMap((p) => fields.map((f) => (p[f] as number) ?? 0)))
}

function barHeight(value: number, max: number): string {
  return `${(value / max) * 100}%`
}

/** '2026-08-24' → '8/24' */
function dayLabel(day: string): string {
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`
}

interface ChartSeries {
  field: string
  label: string
  color: string
}
interface TrendChart {
  title: string
  points: MetricsTrendPoint[]
  series: ChartSeries[]
  max: number
}

/** 趋势图描述：把「哪组数据画成什么颜色」集中成纯数据声明，template 只负责渲染 */
const charts = computed<TrendChart[]>(() => {
  const d = data.value
  if (!d) return []
  const list: TrendChart[] = []

  if (d.d1) {
    const series = [
      { field: 'reads', label: '读', color: '#3692f5' },
      { field: 'writes', label: '写', color: '#fed634' },
    ]
    list.push({
      title: 'D1 近 7 天 · 读 / 写行数',
      points: d.d1.trend,
      series,
      max: maxOf(d.d1.trend, ['reads', 'writes']),
    })
  }

  if (d.r2) {
    const series = [
      { field: 'classA', label: 'Class A', color: '#3692f5' },
      { field: 'classB', label: 'Class B', color: '#ffac00' },
    ]
    list.push({
      title: 'R2 近 7 天 · Class A / B 操作数',
      points: d.r2.trend,
      series,
      max: maxOf(d.r2.trend, ['classA', 'classB']),
    })
  }

  if (d.http && !('error' in d.http)) {
    list.push({
      title: 'HTTP 近 7 天 · 请求量',
      points: d.http.trend,
      series: [{ field: 'requests', label: '请求', color: '#5e7a88' }],
      max: maxOf(d.http.trend, ['requests']),
    })
  }

  return list
})
</script>

<template>
  <div class="metrics-view">
    <div class="list-header">
      <span class="header-title">数据监控</span>
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

      <div v-else-if="data" class="metrics-content">
        <!-- 顶部小卡片 -->
        <div class="metric-cards">
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
        </div>

        <!-- 近 7 天趋势：纯 CSS 柱状条 -->
        <div v-if="charts.length" class="metric-charts">
          <div v-for="chart in charts" :key="chart.title" class="chart-block">
            <h4 class="chart-title">{{ chart.title }}</h4>
            <div class="bar-chart">
              <div v-for="p in chart.points" :key="p.date" class="bar-col">
                <div class="bar-stack">
                  <div
                    v-for="s in chart.series"
                    :key="s.field"
                    class="bar"
                    :style="{
                      height: barHeight((p[s.field] as number) ?? 0, chart.max),
                      background: s.color,
                    }"
                    :title="`${p.date} ${s.label}: ${fmt((p[s.field] as number) ?? 0)}`"
                  />
                </div>
                <span class="bar-day">{{ dayLabel(p.date) }}</span>
              </div>
              <div class="bar-legend">
                <span v-for="s in chart.series" :key="s.field" class="legend-item">
                  <i :style="{ background: s.color }" />
                  {{ s.label }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
