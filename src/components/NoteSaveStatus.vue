<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { liveQuery } from 'dexie'
import { db } from '../db/schema'
import { unsavedDrafts } from '../editor/save-session'
import { openWorkspacePage } from '../navigation'
import { retrySyncNow } from '../sync/engine'
import { useUiStore } from '../stores/ui'
import { notify } from '../notify'

const props = defineProps<{ noteId: string; pending: boolean }>()
const ui = useUiStore()
const online = ref(navigator.onLine)
const loaded = ref(false)
const waiting = ref(false)
const failed = ref(false)
const readError = ref(false)
const retryRead = ref(0)
const drafts = computed(() => unsavedDrafts.value.filter(d => d.id === props.noteId))
let subscription: { unsubscribe(): void } | undefined
watch([() => props.noteId, retryRead], ([id]) => {
  subscription?.unsubscribe()
  loaded.value = false
  readError.value = false
  waiting.value = false
  failed.value = false
  subscription = liveQuery(async () => {
    const [note, tasks] = await Promise.all([db.notes.get(id), db.outbox.where('note_id').equals(id).toArray()])
    return { waiting: !!note && note.dirty !== 'none' || tasks.length > 0, failed: tasks.some(t => t.failed) }
  }).subscribe({
    next(value) { waiting.value = value.waiting; failed.value = value.failed; loaded.value = true },
    error() { readError.value = true },
  })
}, { immediate: true })
const saveFailed = computed(() => drafts.value.some(d => d.error))
const label = computed(() => {
  if (saveFailed.value) return '本地保存异常 · 查看草稿'
  if (readError.value) return '保存状态读取失败 · 点击重试'
  if (props.pending || drafts.value.length) return '正在保存到本机…'
  if (!loaded.value) return '正在读取保存状态…'
  if (!online.value) return '已保存到本机 · 离线'
  if (failed.value) return '已保存到本机 · 同步待重试'
  if (waiting.value) return ui.syncing ? '已保存到本机 · 正在同步' : '已保存到本机 · 等待同步'
  return '已保存并同步'
})
function updateOnline() { online.value = navigator.onLine }
window.addEventListener('online', updateOnline)
window.addEventListener('offline', updateOnline)
onUnmounted(() => {
  subscription?.unsubscribe()
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})
async function act() {
  if (saveFailed.value) { openWorkspacePage('settings', 'data'); return }
  if (readError.value) { retryRead.value++; return }
  if (!online.value) { notify('内容已保存到本机，联网后会继续同步'); return }
  try { await retrySyncNow() } catch (error) { notify(error instanceof Error ? error.message : String(error)) }
}
</script>

<template>
  <div class="note-save-status" role="status" aria-live="polite">
    <button type="button" :class="{ failed: saveFailed || failed || readError }" :disabled="pending || (ui.syncing && !saveFailed && !readError)" :title="`${label}；点击${saveFailed ? '查看草稿' : readError ? '重试读取' : '重试同步'}`" @click="act">{{ label }}</button>
  </div>
</template>
