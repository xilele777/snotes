<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDialogFocus } from './useDialogFocus'
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

const panel = ref<HTMLElement | null>(null)
useDialogFocus(() => props.open, panel, () => emit('close'))

const rows = computed(() => {
  const n = props.note
  if (!n) return []
  // 打开次数按「本机 + 其它设备」的合计显示：只看本机值的话，换台设备看这条
  // 笔记的次数会莫名变小（那台设备确实没打开过几次），和统计页的榜单也对不上。
  const local = n.open_count ?? 0
  const others = n.open_others
  const lastOpen = Math.max(n.last_open_time ?? 0, n.open_others_time ?? 0)
  return [
    { label: '创建时间', value: fmtFull(n.create_time), sub: fmtRelative(n.create_time) },
    { label: '更新时间', value: fmtFull(n.update_time), sub: fmtRelative(n.update_time) },
    { label: '最近打开', value: fmtRelative(lastOpen), sub: fmtFull(lastOpen) },
    {
      label: '打开次数',
      value: others === undefined ? String(local) : String(local + others),
      sub: others === undefined ? `本机 ${local} 次` : `本机 ${local} 次 · 其他设备 ${others} 次`,
    },
    { label: '内容版本', value: String(n.version), sub: n.body_version ? `正文 v${n.body_version}` : '' },
  ]
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
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
          <div class="dialog-footer">
            <button class="dialog-btn ok" @click="emit('close')">关闭</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
