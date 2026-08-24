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
  /** ≤1020px 时侧栏是抽屉，这里是它的展开态；>1020px 侧栏常驻，该值不参与渲染 */
  const drawerOpen = ref(false)

  return { view, activeGroupId, query, syncing, lastSyncError, failedCount, drawerOpen }
})
