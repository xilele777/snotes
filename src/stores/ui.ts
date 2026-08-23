import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ListView } from '../db/repo'

export const useUiStore = defineStore('ui', () => {
  const view = ref<ListView>('all')
  const activeGroupId = ref<string | null>(null)
  const query = ref('')
  const syncing = ref(false)
  const lastSyncError = ref<string | null>(null)
  /** outbox 里 failed=1 的任务数，Task 20 的 push 每轮刷新，非零时界面要给出可见提示 */
  const failedCount = ref(0)

  return { view, activeGroupId, query, syncing, lastSyncError, failedCount }
})
