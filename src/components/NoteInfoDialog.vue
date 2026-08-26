<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import type { LocalNote } from '../../shared/types'

const props = defineProps<{ open: boolean; note: LocalNote | undefined }>()
const emit = defineEmits<{ close: [] }>()

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

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  e.preventDefault()
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown, true)
    else window.removeEventListener('keydown', onKeydown, true)
  }
)
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

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
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="emit('close')">
      <div class="dialog info-dialog" role="dialog" aria-modal="true" aria-label="文档信息">
        <h3 class="dialog-title">文档信息</h3>
        <ul class="info-list">
          <li v-for="r in rows" :key="r.label">
            <span class="info-label">{{ r.label }}</span>
            <span class="info-value">{{ r.value }}</span>
            <span v-if="r.sub" class="info-sub">{{ r.sub }}</span>
          </li>
        </ul>
        <div class="dialog-footer">
          <button class="dialog-btn ok" @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
