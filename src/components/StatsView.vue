<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { computeNoteStats, type NoteStats } from '../../shared/stats'
import { db } from '../db/schema'

const status = ref<'loading' | 'ready'>('loading')
const stats = ref<NoteStats | null>(null)

async function load() {
  status.value = 'loading'
  const [notes, groupList] = await Promise.all([
    db.notes.toArray(),
    db.groups.toArray(),
  ])
  stats.value = computeNoteStats(notes, groupList)
  status.value = 'ready'
}

onMounted(load)

/** 热力图按 weekStart 分组成列 */
const heatWeeks = computed(() => {
  const s = stats.value
  if (!s) return []
  const cols: { weekStart: string; days: { date: string; count: number }[] }[] = []
  for (const cell of s.heatmap) {
    let col = cols.find((c) => c.weekStart === cell.weekStart)
    if (!col) {
      col = { weekStart: cell.weekStart, days: [] }
      cols.push(col)
    }
    col.days.push({ date: cell.date, count: cell.count })
  }
  return cols
})

const heatMax = computed(() => {
  const s = stats.value
  if (!s) return 1
  return Math.max(1, ...s.heatmap.map((c) => c.count))
})

/** 热力图格子颜色分级 0-4 */
function heatLevel(count: number): number {
  if (count === 0) return 0
  const r = count / heatMax.value
  if (r < 0.25) return 1
  if (r < 0.5) return 2
  if (r < 0.75) return 3
  return 4
}

function fmtFull(ts: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayLabel(date: string): string {
  return Number(date.slice(5, 7)) + '/' + Number(date.slice(8))
}

function heatTip(cell: { date: string; count: number }): string {
  return cell.count > 0 ? `${cell.date}：${cell.count} 次更新` : `${cell.date}：无更新`
}

const maxGroupCount = computed(() => {
  const s = stats.value
  if (!s || s.byGroup.length === 0) return 1
  return Math.max(1, ...s.byGroup.map((g) => g.count))
})
</script>

<template>
  <div class="metrics-view stats-view">
    <div class="metrics-topbar">
      <div class="metrics-title">
        <span class="header-title">统计</span>
        <span v-if="status === 'ready'" class="metrics-sub">本地数据 · 更新热力图与写作概览</span>
      </div>
      <button class="metrics-refresh" title="刷新" aria-label="刷新" @click="load">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
        </svg>
      </button>
    </div>

    <div class="metrics-body">
      <p v-if="status === 'loading'" class="metrics-hint">加载中…</p>

      <template v-else-if="stats">
        <!-- 概览 KPI -->
        <section class="metrics-overview">
          <div class="ov-card" data-tone="info">
            <span class="ov-label">笔记总数</span>
            <span class="ov-value">{{ stats.total }}</span>
            <span class="ov-sub">
              正常 {{ stats.active }} 条<template v-if="stats.trashed > 0"> · 回收站 {{ stats.trashed }} 条</template>
            </span>
          </div>
          <div class="ov-card" data-tone="info">
            <span class="ov-label">总字数</span>
            <span class="ov-value">{{ stats.totalWords.toLocaleString('zh-CN') }}</span>
            <span class="ov-sub">{{ stats.totalChars.toLocaleString('zh-CN') }} 可见字符</span>
          </div>
          <div class="ov-card" data-tone="info">
            <span class="ov-label">星标 / 置顶</span>
            <span class="ov-value">{{ stats.starred }} / {{ stats.topped }}</span>
          </div>
          <div class="ov-card" data-tone="info">
            <span class="ov-label">最早 / 最近</span>
            <span class="ov-value" style="font-size:14px">{{ fmtFull(stats.earliest) }}</span>
            <span class="ov-sub">最近更新 {{ fmtFull(stats.latest) }}</span>
          </div>
        </section>

        <!-- 更新热力图 -->
        <section class="stats-heatmap">
          <h4 class="chart-title">更新热力图 · 近 53 周</h4>
          <div class="heatmap-scroll">
            <div class="heatmap-grid">
              <div v-for="col in heatWeeks" :key="col.weekStart" class="heatmap-col">
                <div
                  v-for="cell in col.days"
                  :key="cell.date"
                  class="heatmap-cell"
                  :data-level="heatLevel(cell.count)"
                  :title="heatTip(cell)"
                ></div>
              </div>
            </div>
          </div>
          <div class="heatmap-legend">
            <span class="legend-less">少</span>
            <span class="heatmap-cell" data-level="0"></span>
            <span class="heatmap-cell" data-level="1"></span>
            <span class="heatmap-cell" data-level="2"></span>
            <span class="heatmap-cell" data-level="3"></span>
            <span class="heatmap-cell" data-level="4"></span>
            <span class="legend-more">多</span>
          </div>
        </section>

        <!-- 近 7 天创建 / 更新 -->
        <section class="metric-cards">
          <div class="metric-card">
            <h4 class="card-title">近 7 天 · 创建</h4>
            <div class="mini-bars">
              <div v-for="d in stats.createdLast7" :key="d.date" class="mini-bar-col">
                <div class="mini-bar" :style="{ height: (d.count / Math.max(1, ...stats.createdLast7.map((x) => x.count))) * 100 + '%' }"></div>
                <span class="mini-bar-day">{{ dayLabel(d.date) }}</span>
              </div>
            </div>
          </div>
          <div class="metric-card">
            <h4 class="card-title">近 7 天 · 更新</h4>
            <div class="mini-bars">
              <div v-for="d in stats.updatedLast7" :key="d.date" class="mini-bar-col">
                <div class="mini-bar update" :style="{ height: (d.count / Math.max(1, ...stats.updatedLast7.map((x) => x.count))) * 100 + '%' }"></div>
                <span class="mini-bar-day">{{ dayLabel(d.date) }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 分组分布 -->
        <section v-if="stats.byGroup.length" class="stats-section">
          <h4 class="chart-title">分组分布</h4>
          <ul class="group-bars">
            <li v-for="g in stats.byGroup" :key="g.group_id" class="group-bar">
              <span class="group-dot" :style="g.color ? { backgroundColor: g.color } : undefined"></span>
              <span class="group-bar-name">{{ g.name }}</span>
              <div class="group-bar-track">
                <div class="group-bar-fill" :style="{ width: (g.count / maxGroupCount) * 100 + '%' }"></div>
              </div>
              <span class="group-bar-count">{{ g.count }}</span>
            </li>
          </ul>
        </section>

        <!-- 最常打开 -->
        <section v-if="stats.mostOpened.length" class="stats-section">
          <h4 class="chart-title">最常打开</h4>
          <ol class="most-opened">
            <li v-for="(n, i) in stats.mostOpened" :key="n.id" class="most-opened-item">
              <span class="rank">{{ i + 1 }}</span>
              <span class="most-opened-title">{{ n.title }}</span>
              <span class="most-opened-count">{{ n.open_count }} 次</span>
            </li>
          </ol>
        </section>
      </template>
    </div>
  </div>
</template>
