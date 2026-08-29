<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { computeNoteStats, type NoteStats } from '../../shared/stats'
import { db } from '../db/schema'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'

const status = ref<'loading' | 'ready'>('loading')
const stats = ref<NoteStats | null>(null)
const openedTab = ref<'most' | 'recent'>('most')
const notes = useNotesStore()
const ui = useUiStore()

async function load() {
  status.value = 'loading'
  const [noteList, groupList] = await Promise.all([db.notes.toArray(), db.groups.toArray()])
  stats.value = computeNoteStats(noteList, groupList)
  status.value = 'ready'
}
onMounted(load)

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
const maxLength = computed(() => Math.max(1, ...(stats.value?.lengthBuckets.map((b) => b.count) ?? [])))
const maxDaily = computed(() => Math.max(1, ...((stats.value?.createdLast30 ?? []).map((d, i) => d.count + (stats.value?.updatedLast30[i]?.count ?? 0)))))
const openedList = computed(() => openedTab.value === 'most'
  ? (stats.value?.mostOpened ?? []).map((n) => ({ id: n.id, title: n.title, value: `${n.total_count} 次` }))
  : (stats.value?.recentOpened ?? []).map((n) => ({ id: n.id, title: n.title, value: fmtTime(n.time) }))
)
function heatLevel(count: number): number { if (!count) return 0; const r = count / heatMax.value; return r < .25 ? 1 : r < .5 ? 2 : r < .75 ? 3 : 4 }
function fmtFull(ts: number | null): string { if (!ts) return '-'; const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function fmtTime(ts: number): string { return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function dayLabel(date: string): string { return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` }
function heatTip(cell: { date: string; count: number }): string { return cell.count ? `${cell.date}: ${cell.count} 次更新` : `${cell.date}: 无更新` }
function openNote(id: string) { ui.view = 'all'; notes.currentId = id }
</script>

<template>
  <div class="metrics-view stats-view">
    <div class="metrics-topbar">
      <div class="metrics-title"><span class="header-title">统计</span><span v-if="status === 'ready'" class="metrics-sub">写作节奏、长度与跨设备打开统计</span></div>
      <button class="metrics-refresh" title="刷新" aria-label="刷新" @click="load"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg></button>
    </div>
    <div class="metrics-body">
      <p v-if="status === 'loading'" class="metrics-hint">加载中...</p>
      <div v-else-if="stats" class="stats-grid">
        <section class="stats-numbers"><span><b>{{ stats.total }}</b> 笔记</span><i>·</i><span><b>{{ stats.totalWords.toLocaleString('zh-CN') }}</b> 字</span><i>·</i><span><b>{{ stats.streakCurrent }}</b> 天连续</span><i>·</i><span><b>{{ stats.starred }}</b> 星标</span><i>·</i><span><b>{{ stats.topped }}</b> 置顶</span><i>·</i><span>始于 <b>{{ fmtFull(stats.earliest) }}</b></span></section>
        <section class="stats-panel stats-heatmap"><h4 class="chart-title">更新热力图 <small>近 53 周</small></h4><div class="heatmap-scroll"><div class="heatmap-grid"><div v-for="col in heatWeeks" :key="col.weekStart" class="heatmap-col"><div v-for="cell in col.days" :key="cell.date" class="heatmap-cell" :data-level="heatLevel(cell.count)" :title="heatTip(cell)"></div></div></div></div><div class="heatmap-legend"><span>少</span><span v-for="level in 5" :key="level" class="heatmap-cell" :data-level="level - 1"></span><span>多</span><span class="heatmap-streak">最长连续 {{ stats.streakLongest }} 天</span></div></section>
        <section class="stats-panel writing-hours"><h4 class="chart-title">写作时段</h4><div class="hour-bars"><div v-for="(count, hour) in stats.byHour" :key="hour" class="hour-bar-col" :title="`${hour}:00，${count} 次更新`"><span class="hour-bar" :style="{ height: `${(count / maxHour) * 100}%` }"></span><small v-if="hour % 4 === 0">{{ hour }}</small></div></div><p class="chart-foot">按本地更新时间统计</p></section>
        <section class="stats-panel stats-daily"><h4 class="chart-title">近 30 天创建与更新</h4><div class="daily-bars"><div v-for="(created, index) in stats.createdLast30" :key="created.date" class="daily-bar-col" :title="`${created.date}: 创建 ${created.count}，更新 ${stats.updatedLast30[index].count}`"><span class="daily-bar created" :style="{ height: `${(created.count / maxDaily) * 100}%` }"></span><span class="daily-bar updated" :style="{ height: `${(stats.updatedLast30[index].count / maxDaily) * 100}%` }"></span><small v-if="index % 5 === 0">{{ dayLabel(created.date) }}</small></div></div><p class="chart-foot"><span class="legend-created"></span>创建 <span class="legend-updated"></span>更新</p></section>
        <section class="stats-panel length-panel"><h4 class="chart-title">长度分布</h4><div class="length-bars"><div v-for="bucket in stats.lengthBuckets" :key="bucket.label" class="length-row"><span>{{ bucket.label }}</span><div><i :style="{ width: `${(bucket.count / maxLength) * 100}%` }"></i></div><b>{{ bucket.count }}</b></div></div><p class="chart-foot">平均 {{ Math.round(stats.avgWords) }} 字<span v-if="stats.longest"> · 最长 <button @click="openNote(stats.longest.id)">《{{ stats.longest.title }}》{{ stats.longest.words }} 字</button></span></p></section>
        <section class="stats-panel group-panel"><h4 class="chart-title">分组分布</h4><ul v-if="stats.byGroup.length" class="group-bars"><li v-for="g in stats.byGroup" :key="g.group_id" class="group-bar"><span class="group-dot" :style="g.color ? { backgroundColor: g.color } : undefined"></span><span class="group-bar-name">{{ g.name }}</span><div class="group-bar-track"><div class="group-bar-fill" :style="{ width: `${(g.count / maxGroupCount) * 100}%` }"></div></div><span class="group-bar-count">{{ g.count }}</span></li></ul><p v-else class="chart-foot">暂无笔记</p></section>
        <section class="stats-panel opened-panel"><div class="opened-heading"><h4 class="chart-title">打开榜</h4><div class="opened-tabs"><button :class="{ active: openedTab === 'most' }" @click="openedTab = 'most'">最常</button><button :class="{ active: openedTab === 'recent' }" @click="openedTab = 'recent'">最近</button></div></div><ol v-if="openedList.length" class="most-opened"><li v-for="(n, i) in openedList" :key="n.id" class="most-opened-item"><span class="rank">{{ i + 1 }}</span><button class="most-opened-title" @click="openNote(n.id)">{{ n.title }}</button><span class="most-opened-count">{{ n.value }}</span></li></ol><p v-else class="chart-foot">暂无打开记录</p></section>
      </div>
    </div>
  </div>
</template>
