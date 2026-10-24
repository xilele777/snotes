<script setup lang="ts">
import '../insights.css'
import { computed, onMounted, ref, watch } from 'vue'
import { computeNoteStats, type NoteStats } from '../../shared/stats'
import { joinBodies, notebookOwnedNoteIds } from '../db/repo'
import { db } from '../db/schema'
import { buildActivity, localDateKey } from '../stats-activity'
import type { LocalNoteWithBody } from '../../shared/types'
import ActionMenu from './ActionMenu.vue'
import AppIcon from './AppIcon.vue'

const status = ref<'loading' | 'ready'>('loading')
const stats = ref<NoteStats | null>(null)
const hoveredDay = ref<number | null>(null)
const chartElement = ref<HTMLElement | null>(null)
const chartWidth = ref(600)
watch(
  chartElement,
  (element, _previous, onCleanup) => {
    if (!element) return
    const resize = () => {
      chartWidth.value = Math.max(240, element.clientWidth)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  },
  { flush: 'post' },
)
const notes = ref<LocalNoteWithBody[]>([])
const period = ref('30')
const periodTrigger = ref<HTMLElement | null>(null)
const periodOpen = ref(false)
const periodOptions = [
  { value: '7', label: '近 7 天' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
  { value: '365', label: '近一年' },
  { value: 'custom', label: '自定义日期' },
]
const periodLabel = computed(() => periodOptions.find((option) => option.value === period.value)?.label)
const today = localDateKey(new Date())
const initialStart = new Date(`${today}T00:00:00`)
initialStart.setDate(initialStart.getDate() - 29)
const customStart = ref(localDateKey(initialStart))
const customEnd = ref(today)
const dateRange = computed(() => {
  if (period.value === 'custom') return { start: customStart.value, end: customEnd.value }
  const start = new Date(`${today}T00:00:00`)
  start.setDate(start.getDate() - Number(period.value) + 1)
  return { start: localDateKey(start), end: today }
})
watch([period, customStart, customEnd], () => {
  hoveredDay.value = null
})

async function load() {
  status.value = 'loading'
  // 统计只统计「外面的笔记」：属于笔记本的笔记和首页信息流一样不该出现在这里。
  const [noteList, groupList, owned] = await Promise.all([db.notes.toArray(), db.groups.toArray(), notebookOwnedNoteIds()])
  // 字数统计要扫正文：笔记行已是纯元数据，这里把正文一次性拼上再算
  notes.value = await joinBodies(noteList.filter((note) => !owned.has(note.id)))
  stats.value = computeNoteStats(notes.value, groupList)
  status.value = 'ready'
}
onMounted(load)

const num = (value: number) => Math.round(value).toLocaleString('zh-CN')

/** 热力图按周分列，窄屏只在日历内部横向滚动。 */
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
const heatMax = computed(() => Math.max(1, ...(stats.value?.heatmap.map((c) => c.count) ?? [])))
const heatMonths = computed(() =>
  heatWeeks.value.flatMap((week, index, weeks) => {
    const month = week.weekStart.slice(5, 7)
    return index === 0 || month !== weeks[index - 1]?.weekStart.slice(5, 7) ? [{ column: index + 1, label: `${Number(month)}月` }] : []
  }),
)
const activity = computed(() => buildActivity(notes.value, dateRange.value.start, dateRange.value.end))
const rangeValid = computed(() => activity.value.buckets.length > 0)
const totalCreated = computed(() => activity.value.buckets.reduce((sum, day) => sum + day.created, 0))
const totalUpdated = computed(() => activity.value.buckets.reduce((sum, day) => sum + day.updated, 0))
const rangeLabel = computed(() => (period.value === 'custom' ? '所选时间' : period.value === '365' ? '近一年' : `近 ${period.value} 天`))
const dailySeries = computed(() => {
  const buckets = activity.value.buckets
  const max = Math.max(2, ...buckets.flatMap((bucket) => [bucket.created, bucket.updated]))
  const ceiling = Math.ceil(max / 2) * 2
  const slot = (chartWidth.value - 60) / Math.max(1, buckets.length)
  const y = (value: number) => 182 - (value / ceiling) * 150
  return {
    ticks: [0, ceiling / 2, ceiling].map((value) => ({ value, y: y(value) })),
    days: buckets.map((bucket, index) => ({
      ...bucket,
      x: 36 + slot * (index + 0.5),
      width: Math.min(18, slot * 0.32),
      slot,
      createdY: y(bucket.created),
      updatedY: y(bucket.updated),
      showLabel: index === 0 || index === buckets.length - 1 || index % Math.ceil(buckets.length / 4) === 0,
    })),
  }
})
const selectedDay = computed(() => (hoveredDay.value === null ? null : dailySeries.value.days[hoveredDay.value]))

/** 0 = 无更新；1-4 按当天次数占最高单日的比例分四档，任何非零值至少是 1 档 */
function heatLevel(count: number): number {
  if (!count) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / heatMax.value) * 4)))
}
function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
}
function heatTip(cell: { date: string; count: number }): string {
  return cell.count ? `${cell.date}：更新 ${cell.count} 条` : `${cell.date}：无更新`
}
</script>

<template>
  <div class="metrics-view stats-view" aria-label="统计">
    <div class="metrics-body">
      <p v-if="status === 'loading'" class="metrics-hint">正在统计…</p>
      <div v-else-if="stats" class="stats-layout">
        <main class="stats-main">
          <div class="stats-grid">
            <section class="stats-panel panel-overview" aria-label="总体数据">
              <div class="writing-overview">
                <section class="panel-daily" aria-label="创建与更新柱状图">
                  <header class="panel-head">
                    <h2 class="panel-title">创建与更新</h2>
                    <button
                      ref="periodTrigger"
                      type="button"
                      class="stats-period"
                      :aria-label="`统计时间范围：${periodLabel}`"
                      aria-haspopup="menu"
                      :aria-expanded="periodOpen"
                      @click="periodOpen = !periodOpen"
                      @keydown.down.prevent="periodOpen = true"
                      @keydown.up.prevent="periodOpen = true"
                    >
                      <span>{{ periodLabel }}</span>
                      <AppIcon name="chevron" :size="14" class="stats-period-chevron" :class="{ expanded: periodOpen }" />
                    </button>
                    <ActionMenu :open="periodOpen" :anchor="periodTrigger" label="统计时间范围" menu-class="stats-period-menu" focus-checked @close="periodOpen = false">
                      <button
                        v-for="option in periodOptions"
                        :key="option.value"
                        type="button"
                        class="menu-item"
                        role="menuitemradio"
                        :aria-checked="period === option.value"
                        @click="period = option.value; periodOpen = false"
                      >
                        <span>{{ option.label }}</span>
                        <AppIcon v-if="period === option.value" name="check" :size="14" class="menu-check" />
                      </button>
                    </ActionMenu>
                  </header>
                  <div v-if="period === 'custom'" class="stats-date-range">
                    <label>开始<input v-model="customStart" type="date" aria-label="开始日期" :max="customEnd || today" /></label>
                    <span aria-hidden="true">—</span>
                    <label>结束<input v-model="customEnd" type="date" aria-label="结束日期" :min="customStart" :max="today" /></label>
                  </div>
                  <p v-if="!rangeValid" class="stats-range-error" role="alert">请选择有效日期，结束日期不能早于开始日期。</p>
                  <template v-else>
                    <div class="daily-heading">
                      <span class="daily-legend"><i class="legend-line created"></i>创建<i class="legend-line updated"></i>更新</span>
                    </div>
                    <div ref="chartElement" class="daily-chart" @mouseleave="hoveredDay = null">
                      <svg
                        :viewBox="`0 0 ${chartWidth} 220`"
                        preserveAspectRatio="none"
                        role="group"
                        :aria-label="`${rangeLabel}创建和更新的笔记数`"
                      >
                        <g v-for="tick in dailySeries.ticks" :key="tick.value" class="daily-gridline">
                          <line x1="36" :x2="chartWidth - 24" :y1="tick.y" :y2="tick.y" />
                          <text x="25" :y="tick.y + 4" text-anchor="end">{{ tick.value }}</text>
                        </g>
                        <g v-for="(day, index) in dailySeries.days" :key="day.start">
                          <rect
                            class="daily-bar created"
                            :x="day.x - day.width - 1"
                            :y="day.createdY"
                            :width="day.width"
                            :height="182 - day.createdY"
                            rx="2"
                          />
                          <rect
                            class="daily-bar updated"
                            :x="day.x + 1"
                            :y="day.updatedY"
                            :width="day.width"
                            :height="182 - day.updatedY"
                            rx="2"
                          />
                          <text
                            v-if="day.showLabel"
                            class="daily-date"
                            :x="day.x"
                            y="210"
                            :text-anchor="index === 0 ? 'start' : index === dailySeries.days.length - 1 ? 'end' : 'middle'"
                          >
                            {{ dayLabel(day.start) }}
                          </text>
                          <rect
                            class="daily-hit"
                            :x="day.x - day.slot / 2"
                            y="20"
                            :width="day.slot"
                            height="165"
                            tabindex="0"
                            role="img"
                            :aria-label="`${day.start}${day.end !== day.start ? ' 至 ' + day.end : ''}：创建 ${day.created} 篇，更新 ${day.updated} 篇`"
                            @mouseenter="hoveredDay = index"
                            @click="hoveredDay = index"
                            @focus="hoveredDay = index"
                            @blur="hoveredDay = null"
                          >
                            <title>
                              {{ day.start }}{{ day.end !== day.start ? ` 至 ${day.end}` : '' }}：创建 {{ day.created }} 篇，更新
                              {{ day.updated }} 篇
                            </title>
                          </rect>
                        </g>
                      </svg>
                      <div
                        v-if="selectedDay"
                        class="daily-tooltip"
                        :style="{ left: `clamp(0px, ${(selectedDay.x / chartWidth) * 100}%, calc(100% - 164px))` }"
                      >
                        <b>{{ selectedDay.start }}{{ selectedDay.end !== selectedDay.start ? ` 至 ${selectedDay.end}` : '' }}</b>
                        <span>创建 {{ selectedDay.created }} 篇 · 更新 {{ selectedDay.updated }} 篇</span>
                      </div>
                    </div>
                  </template>
                </section>
                <div class="stats-totals" aria-label="笔记数据">
                  <article class="total-card total-card-primary" data-kpi="notes">
                    <span class="total-label">笔记总数</span><strong>{{ num(stats.active) }}<small>篇</small></strong>
                    <span class="total-sub">星标 <b>{{ num(stats.starred) }}</b> · 置顶 <b>{{ num(stats.topped) }}</b></span>
                  </article>
                  <article class="total-card" data-kpi="words">
                    <span class="total-label">累计字数</span><strong>{{ num(stats.totalWords) }}</strong>
                    <span class="total-sub">平均 <b>{{ num(stats.avgWords) }}</b> 字 / 篇</span>
                  </article>
                  <article class="total-card" data-kpi="created">
                    <span class="total-label">{{ rangeLabel }}创建</span
                    ><strong>{{ rangeValid ? num(totalCreated) : '—' }}<small>篇</small></strong>
                  </article>
                  <article class="total-card" data-kpi="updated">
                    <span class="total-label">{{ rangeLabel }}更新</span
                    ><strong>{{ rangeValid ? num(totalUpdated) : '—' }}<small>篇</small></strong>
                  </article>
                </div>
              </div>
            </section>

            <section class="stats-panel panel-heatmap">
              <header class="panel-head">
                <div>
                  <h2 class="panel-title">编辑热力图</h2>
                </div>
                <div class="streak-summary">
                  <span
                    >连续 <b>{{ stats.streakCurrent }}</b> 天</span
                  ><span
                    >最长 <b>{{ stats.streakLongest }}</b> 天</span
                  >
                </div>
              </header>
              <div class="heatmap-scroll" tabindex="0" aria-label="全年写作热力图，可横向浏览">
                <div class="heatmap-calendar">
                  <div class="heatmap-months" aria-hidden="true">
                    <span
                      v-for="month in heatMonths"
                      :key="month.column"
                      :style="{ gridColumn: `${month.column} / span ${Math.min(2, 54 - month.column)}` }"
                      >{{ month.label }}</span
                    >
                  </div>
                  <div class="heatmap-calendar-body">
                    <div class="heatmap-weekdays" aria-hidden="true">
                      <span v-for="(day, index) in ['一', '', '三', '', '五', '', '日']" :key="index">{{ day }}</span>
                    </div>
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
                </div>
              </div>
              <footer class="panel-foot heatmap-legend">
                <span>少</span><span v-for="level in 5" :key="level" class="heatmap-cell" :data-level="level - 1"></span><span>多</span>
              </footer>
            </section>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>
