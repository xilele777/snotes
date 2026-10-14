<script setup lang="ts">
import '../insights.css'
import { computed, onMounted, ref } from 'vue'
import { computeNoteStats, type NoteStats } from '../../shared/stats'
import { db } from '../db/schema'

const emit = defineEmits<{ selectNote: [id: string] }>()

const status = ref<'loading' | 'ready'>('loading')
const stats = ref<NoteStats | null>(null)
const openedTab = ref<'most' | 'recent'>('most')

async function load() {
  status.value = 'loading'
  const [noteList, groupList] = await Promise.all([db.notes.toArray(), db.groups.toArray()])
  stats.value = computeNoteStats(noteList, groupList)
  status.value = 'ready'
}
onMounted(load)

const num = (value: number) => Math.round(value).toLocaleString('zh-CN')

/**
 * 顶部 KPI：第一屏只回答「写了多少、坚持得怎么样、有多少条不在首页」。
 * 每张卡都带一行副标题，把回收站、置顶这类零散数字一并交代掉，
 * 不再为它们各开一个面板。
 */
const kpis = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { key: 'notes', label: '笔记', value: num(s.active), unit: '', sub: s.earliest ? `始于 ${fmtFull(s.earliest)}` : '还没有笔记' },
    { key: 'words', label: '总字数', value: num(s.totalWords), unit: '', sub: s.active ? `平均 ${num(s.avgWords)} 字/篇` : '—' },
    { key: 'streak', label: '连续写作', value: String(s.streakCurrent), unit: '天', sub: `历史最长 ${s.streakLongest} 天` },
    { key: 'star', label: '星标', value: num(s.starred), unit: '', sub: `置顶 ${s.topped} 条` },
    { key: 'hidden', label: '不上首页', value: num(s.hidden), unit: '', sub: `回收站 ${s.trashed} 条` },
  ]
})

/** 热力图按周分列：53 列 × 7 行，列宽随容器收缩，不产生横向滚动 */
const heatWeeks = computed(() => {
  const s = stats.value
  if (!s) return []
  const cols: { weekStart: string; days: { date: string; count: number }[] }[] = []
  for (const cell of s.heatmap) {
    let col = cols.find((c) => c.weekStart === cell.weekStart)
    if (!col) { col = { weekStart: cell.weekStart, days: [] }; cols.push(col) }
    col.days.push({ date: cell.date, count: cell.count })
  }
  return cols
})
const heatMax = computed(() => Math.max(1, ...(stats.value?.heatmap.map((c) => c.count) ?? [])))
const maxGroupCount = computed(() => Math.max(1, ...(stats.value?.byGroup.map((g) => g.count) ?? [])))
const maxHour = computed(() => Math.max(1, ...(stats.value?.byHour ?? [])))
/** 写作时段的高峰小时：柱状图上单独标出来，一眼看到自己的高产时段 */
const peakHour = computed(() => {
  const hours = stats.value?.byHour ?? []
  if (hours.length === 0) return -1
  const peak = Math.max(...hours)
  return peak > 0 ? hours.indexOf(peak) : -1
})
const maxLength = computed(() => Math.max(1, ...(stats.value?.lengthBuckets.map((b) => b.count) ?? [])))
const maxDaily = computed(() => Math.max(1, ...((stats.value?.createdLast30 ?? []).map((d, i) => d.count + (stats.value?.updatedLast30[i]?.count ?? 0)))))
const totalHourUpdates = computed(() => (stats.value?.byHour ?? []).reduce((sum, count) => sum + count, 0))
const totalCreatedLast30 = computed(() => (stats.value?.createdLast30 ?? []).reduce((sum, day) => sum + day.count, 0))
const totalUpdatedLast30 = computed(() => (stats.value?.updatedLast30 ?? []).reduce((sum, day) => sum + day.count, 0))
const hasHourlyUpdates = computed(() => totalHourUpdates.value > 0)
const hasDailyActivity = computed(() => totalCreatedLast30.value + totalUpdatedLast30.value > 0)

/** 打开榜：两页共用一条相对长度，最常打开一眼看出差距 */
const openedRows = computed(() => {
  const s = stats.value
  if (!s) return []
  if (openedTab.value === 'recent') {
    return s.recentOpened.map((n) => ({ id: n.id, title: n.title, value: fmtTime(n.time), ratio: 0 }))
  }
  const max = Math.max(1, ...s.mostOpened.map((n) => n.total_count))
  return s.mostOpened.map((n) => ({ id: n.id, title: n.title, value: `${num(n.total_count)} 次`, ratio: n.total_count / max }))
})

/** 0 = 无更新；1-4 按当天次数占最高单日的比例分四档，任何非零值至少是 1 档 */
function heatLevel(count: number): number { if (!count) return 0; return Math.min(4, Math.max(1, Math.ceil((count / heatMax.value) * 4))) }
function fmtFull(ts: number | null): string { if (!ts) return '-'; const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function fmtTime(ts: number): string { return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function dayLabel(date: string): string { return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` }
function heatTip(cell: { date: string; count: number }): string { return cell.count ? `${cell.date}：更新 ${cell.count} 条` : `${cell.date}：无更新` }
function openNote(id: string) { emit('selectNote', id) }
</script>

<template>
  <div class="metrics-view stats-view" aria-label="记录统计">
    <div class="metrics-body">
      <p v-if="status === 'loading'" class="metrics-hint">正在统计…</p>

      <template v-else-if="stats">
        <section class="stats-kpis" aria-label="总体数据">
          <article v-for="kpi in kpis" :key="kpi.key" class="kpi-card" :data-kpi="kpi.key">
            <span class="kpi-label">{{ kpi.label }}</span>
            <p class="kpi-value"><b>{{ kpi.value }}</b><i v-if="kpi.unit">{{ kpi.unit }}</i></p>
            <span class="kpi-sub">{{ kpi.sub }}</span>
          </article>
        </section>

        <div class="stats-grid">
          <section class="stats-panel panel-heatmap">
            <header class="panel-head">
              <h4 class="panel-title">更新热力图<small>近 53 周</small></h4>
              <span class="panel-meta">最长连续 {{ stats.streakLongest }} 天</span>
            </header>
            <div class="heatmap-grid">
              <div v-for="col in heatWeeks" :key="col.weekStart" class="heatmap-col">
                <div v-for="cell in col.days" :key="cell.date" class="heatmap-cell" :data-level="heatLevel(cell.count)" :title="heatTip(cell)"></div>
              </div>
            </div>
            <footer class="panel-foot heatmap-legend"><span>少</span><span v-for="level in 5" :key="level" class="heatmap-cell" :data-level="level - 1"></span><span>多</span></footer>
          </section>

          <section class="stats-panel panel-hours">
            <header class="panel-head">
              <h4 class="panel-title">写作时段</h4>
              <span class="panel-meta">{{ num(totalHourUpdates) }} 次更新</span>
            </header>
            <div v-if="hasHourlyUpdates" class="hour-bars">
              <div v-for="(count, hour) in stats.byHour" :key="hour" class="hour-col" :data-peak="hour === peakHour" :title="`${hour}:00，更新 ${count} 次`">
                <span class="hour-bar" :style="{ height: `${(count / maxHour) * 100}%` }"></span>
                <small v-if="hour % 6 === 0">{{ hour }}</small>
              </div>
            </div>
            <p v-else class="panel-empty">还没有可统计的更新时间</p>
            <footer class="panel-foot">{{ peakHour >= 0 ? `高峰在 ${peakHour}:00 前后 · 按本机时间` : '按本机时间统计' }}</footer>
          </section>

          <section class="stats-panel panel-daily">
            <header class="panel-head">
              <h4 class="panel-title">近 30 天</h4>
              <span class="panel-meta">{{ num(totalCreatedLast30) }} 创建 · {{ num(totalUpdatedLast30) }} 更新</span>
            </header>
            <div v-if="hasDailyActivity" class="daily-bars">
              <div v-for="(created, index) in stats.createdLast30" :key="created.date" class="daily-col" :title="`${created.date}：创建 ${created.count}，更新 ${stats.updatedLast30[index].count}`">
                <span class="daily-bar created" :style="{ height: `${(created.count / maxDaily) * 100}%` }"></span>
                <span class="daily-bar updated" :style="{ height: `${(stats.updatedLast30[index].count / maxDaily) * 100}%` }"></span>
                <small v-if="index % 5 === 0">{{ dayLabel(created.date) }}</small>
              </div>
            </div>
            <p v-else class="panel-empty">近 30 天没有创建或更新</p>
            <footer class="panel-foot"><span class="legend-dot created"></span>创建<span class="legend-dot updated"></span>更新</footer>
          </section>

          <section class="stats-panel panel-opened">
            <header class="panel-head">
              <h4 class="panel-title">打开榜</h4>
              <div class="opened-tabs" role="tablist" aria-label="打开榜排序">
                <button type="button" role="tab" :aria-selected="openedTab === 'most'" :class="{ active: openedTab === 'most' }" @click="openedTab = 'most'">最常</button>
                <button type="button" role="tab" :aria-selected="openedTab === 'recent'" :class="{ active: openedTab === 'recent' }" @click="openedTab = 'recent'">最近</button>
              </div>
            </header>
            <ol v-if="openedRows.length" class="opened-list">
              <li v-for="(row, index) in openedRows" :key="row.id" class="opened-item">
                <span class="opened-rank">{{ index + 1 }}</span>
                <span class="opened-track"><i v-if="row.ratio" :style="{ width: `${row.ratio * 100}%` }"></i></span>
                <button type="button" class="opened-title" @click="openNote(row.id)">{{ row.title }}</button>
                <span class="opened-value">{{ row.value }}</span>
              </li>
            </ol>
            <p v-else class="panel-empty">还没有打开记录</p>
            <footer class="panel-foot">{{ openedTab === 'most' ? `累计打开 ${num(stats.totalOpens)} 次 · 含其它设备` : '按最近一次打开时间排序' }}</footer>
          </section>

          <section class="stats-panel panel-group">
            <header class="panel-head">
              <h4 class="panel-title">分组分布</h4>
              <span class="panel-meta">{{ stats.byGroup.length }} 个分组</span>
            </header>
            <ul v-if="stats.byGroup.length" class="group-bars">
              <li v-for="g in stats.byGroup" :key="g.group_id" class="group-row">
                <span class="group-dot" :style="g.color ? { backgroundColor: g.color } : undefined"></span>
                <span class="group-name">{{ g.name }}</span>
                <span class="group-track"><i :style="{ width: `${(g.count / maxGroupCount) * 100}%` }"></i></span>
                <span class="group-count">{{ g.count }}</span>
              </li>
            </ul>
            <p v-else class="panel-empty">还没有笔记</p>
            <footer class="panel-foot">按条数排序</footer>
          </section>

          <section class="stats-panel panel-length">
            <header class="panel-head">
              <h4 class="panel-title">篇幅分布</h4>
              <span class="panel-meta">平均 {{ num(stats.avgWords) }} 字</span>
            </header>
            <div class="length-bars">
              <div v-for="bucket in stats.lengthBuckets" :key="bucket.label" class="length-row">
                <span class="length-label">{{ bucket.label }}</span>
                <span class="length-track"><i :style="{ width: `${(bucket.count / maxLength) * 100}%` }"></i></span>
                <b>{{ bucket.count }}</b>
              </div>
            </div>
            <footer class="panel-foot">
              <template v-if="stats.longest">
                最长一篇
                <button type="button" class="link-button" @click="openNote(stats.longest.id)">《{{ stats.longest.title }}》</button>
                {{ num(stats.longest.words) }} 字
              </template>
              <template v-else>还没有正文</template>
            </footer>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>
