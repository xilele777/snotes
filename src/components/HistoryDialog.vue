<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDialogFocus } from './useDialogFocus'
import { countWords } from '../../shared/derive'
import { fetchCloudHistory, listHistory, mergeHistory, type MergedHistoryEntry } from '../db/history'
import type { LocalNote } from '../../shared/types'

/**
 * 正文历史弹窗：本机快照与云端快照合并显示，同一份正文两边都有时只列一条。
 * 云端拿不到（离线、旧服务端）时只显示本机部分。只读态无恢复按钮。
 */
const props = defineProps<{ open: boolean; note: LocalNote | undefined; readonly?: boolean }>()
const emit = defineEmits<{ close: []; restore: [body: string] }>()

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
const history = ref<MergedHistoryEntry[]>([])
const previewId = ref<string | null>(null)
const loadingCloud = ref(false)
async function loadHistory() {
  const id = props.note?.id
  if (!props.open || !id) { history.value = []; previewId.value = null; return }
  const local = await listHistory(id)
  if (props.note?.id !== id) return
  // 本机部分先显示，云端到了再合并进来
  history.value = mergeHistory(local, [])
  loadingCloud.value = true
  const cloud = await fetchCloudHistory(id)
  loadingCloud.value = false
  if (props.note?.id === id && props.open) history.value = mergeHistory(local, cloud)
}
watch(() => [props.open, props.note?.id, props.note?.update_time] as const, loadHistory, { immediate: true })

const words = (body: string) => countWords(body).words
function togglePreview(key: string) {
  previewId.value = previewId.value === key ? null : key
}
const sourceLabel = (entry: MergedHistoryEntry) => entry.sources.map((s) => (s === 'local' ? '本机' : '云端')).join(' · ')
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="emit('close')">
      <div ref="panel" class="dialog history-dialog" role="dialog" aria-modal="true" aria-label="历史版本">
        <h3 class="dialog-title">历史版本<span v-if="history.length" class="history-count">{{ history.length }} 条</span></h3>
        <p v-if="loadingCloud" class="history-hint">正在读取云端…</p>
        <section class="history" aria-label="历史版本列表">
          <p v-if="history.length === 0" class="history-empty">暂无历史版本。</p>
          <ul v-else class="history-list">
            <li v-for="entry in history" :key="entry.key" class="history-item" :class="{ open: previewId === entry.key }" :data-sources="entry.sources.join(' ')">
              <div class="history-row">
                <span class="history-time" :title="fmtFull(entry.time)">{{ fmtRelative(entry.time) }}</span>
                <span class="history-source">{{ sourceLabel(entry) }}</span>
                <span class="history-words">{{ words(entry.body) }} 字</span>
                <button class="history-btn" type="button" :aria-expanded="previewId === entry.key" @click="togglePreview(entry.key)">{{ previewId === entry.key ? '收起' : '预览' }}</button>
                <button v-if="!readonly" class="history-btn restore" type="button" data-op="restore" @click="emit('restore', entry.body)">恢复</button>
              </div>
              <pre v-if="previewId === entry.key" class="history-preview">{{ entry.body }}</pre>
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
