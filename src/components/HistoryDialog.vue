<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDialogFocus } from './useDialogFocus'
import { countWords } from '../../shared/derive'
import { listHistory, type HistoryEntry } from '../db/history'
import type { LocalNote } from '../../shared/types'

/**
 * 本地正文历史弹窗。从「文档信息」里拆出来单独成条目：刚误删了一段的人要找的是它，
 * 不会想到去点 ⓘ。加载时机、空态文案、只读态无恢复按钮都与拆分前一致。
 */
const props = defineProps<{ open: boolean; note: LocalNote | undefined; readonly?: boolean }>()
const emit = defineEmits<{ close: []; restore: [historyId: number] }>()

function fmtFull(ts: number | undefined | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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

/** 弹窗打开或正文变化（恢复之后）时重新读；展开预览的那条用 id 记，列表刷新后仍能对上。 */
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
      <div ref="panel" class="dialog history-dialog" role="dialog" aria-modal="true" aria-label="历史版本">
        <h3 class="dialog-title">历史版本<span v-if="history.length" class="history-count">{{ history.length }} 条</span></h3>
        <p class="history-hint">只保存在本设备，正文改动间隔满 5 分钟或一次改动较大时自动留存。</p>
        <section class="history" aria-label="历史版本列表">
          <p v-if="history.length === 0" class="history-empty">暂无历史版本。</p>
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
