<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDialogFocus } from './useDialogFocus'
import { countWords } from '../../shared/derive'
import { listHistory, type HistoryEntry } from '../db/history'
import type { LocalNote } from '../../shared/types'

const props = defineProps<{ open: boolean; note: LocalNote | undefined; readonly?: boolean }>()
const emit = defineEmits<{ close: []; restore: [historyId: number] }>()

/** 日期格式化：完整展示年月日时分 */
function fmtFull(ts: number | undefined | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期 */
function fmtRelative(ts: number | undefined | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前'
  if (diff < 30 * 86_400_000) return Math.floor(diff / 86_400_000) + ' 天前'
  return fmtFull(ts)
}

const panel = ref<HTMLElement | null>(null)
useDialogFocus(() => props.open, panel, () => emit('close'))

const rows = computed(() => {
  const n = props.note
  if (!n) return []
  return [
    { label: '创建时间', value: fmtFull(n.create_time), sub: fmtRelative(n.create_time) },
    { label: '更新时间', value: fmtFull(n.update_time), sub: fmtRelative(n.update_time) },
    { label: '最近打开', value: fmtRelative(n.last_open_time), sub: fmtFull(n.last_open_time) },
    { label: '打开次数', value: String(n.open_count ?? 0), sub: '' },
    { label: '内容版本', value: String(n.version), sub: n.body_version ? `正文 v${n.body_version}` : '' },
  ]
})

/**
 * 本地正文历史。弹窗打开或正文变化（恢复之后）时重新读；
 * 展开预览的那条用 id 记，列表刷新后仍能对上。
 */
const history = ref<HistoryEntry[]>([])
const previewId = ref<number | null>(null)
async function loadHistory() {
  const id = props.note?.id
  if (!props.open || !id) { history.value = []; previewId.value = null; return }
  const rows = await listHistory(id)
  if (props.note?.id === id) history.value = rows
}
watch(() => [props.open, props.note?.id, props.note?.update_time] as const, loadHistory, { immediate: true })

const words = (body: string) => countWords(body).words
function togglePreview(id: number) {
  previewId.value = previewId.value === id ? null : id
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="emit('close')">
      <div ref="panel" class="dialog info-dialog" role="dialog" aria-modal="true" aria-label="文档信息">
        <h3 class="dialog-title">文档信息</h3>
        <ul class="info-list">
          <li v-for="r in rows" :key="r.label">
            <span class="info-label">{{ r.label }}</span>
            <span class="info-value">{{ r.value }}</span>
            <span v-if="r.sub" class="info-sub">{{ r.sub }}</span>
          </li>
        </ul>

        <section class="history" aria-label="历史版本">
          <h4 class="history-title">历史版本<span class="history-count">{{ history.length ? `${history.length} 条` : '' }}</span></h4>
          <p v-if="history.length === 0" class="history-empty">暂无历史版本。正文改动间隔满 5 分钟、或一次改动较大时会自动留存，只保存在本设备。</p>
          <ul v-else class="history-list">
            <li v-for="entry in history" :key="entry.id" class="history-item" :class="{ open: previewId === entry.id }">
              <div class="history-row">
                <span class="history-time" :title="fmtFull(entry.time)">{{ fmtRelative(entry.time) }}</span>
                <span class="history-words">{{ words(entry.body) }} 字</span>
                <button class="history-btn" type="button" :aria-expanded="previewId === entry.id" @click="togglePreview(entry.id)">{{ previewId === entry.id ? '收起' : '预览' }}</button>
                <button v-if="!readonly" class="history-btn restore" type="button" data-op="restore" @click="emit('restore', entry.id)">恢复</button>
              </div>
              <pre v-if="previewId === entry.id" class="history-preview">{{ entry.body }}</pre>
            </li>
          </ul>
        </section>

        <div class="dialog-footer">
          <button class="dialog-btn ok" @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
