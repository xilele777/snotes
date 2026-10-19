<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { liveQuery } from 'dexie'
import type { OutboxTask } from '../../../shared/types'
import { db } from '../../db/schema'
import { retrySyncNow } from '../../sync/engine'
import AppIcon from '../AppIcon.vue'
import { buildBackup, importBackup, type BackupProgress } from '../../export/backup'
import { downloadBlob, downloadMarkdown } from '../../export/share'
import { unsavedDrafts, saveDraft, discardDraft } from '../../editor/save-session'
import { createConflictCopy, getNote, updateBody } from '../../db/repo'

/** 设置「数据」页：导出全部、导入备份。逻辑自原 BackupDialog 迁入，断言用的 data-action 与类名不变。 */
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const progress = ref<BackupProgress | null>(null)
const message = ref('')
const failed = ref(false)
const failedTasks = ref<OutboxTask[]>([])
let failedSubscription: { unsubscribe(): void } | undefined
onMounted(() => {
  failedSubscription = liveQuery(() => db.outbox.where('failed').equals(1).toArray()).subscribe(tasks => { failedTasks.value = tasks })
})
onUnmounted(() => failedSubscription?.unsubscribe())

function downloadFailedTask(task: OutboxTask) {
  downloadBlob(new Blob([JSON.stringify(task, null, 2)], { type: 'application/json' }), `snotes-failed-${task.id}.json`)
}

async function retryFailedTasks() {
  busy.value = true
  try { await retrySyncNow() }
  catch (error) { failed.value = true; message.value = error instanceof Error ? error.message : String(error) }
  finally { busy.value = false }
}

async function recoverDraft(id: string) {
  failed.value = false
  try {
    await saveDraft(id, async (noteId, body, base) => {
      const note = await getNote(noteId)
      if (note && note.invalid === 0) await updateBody(noteId, body, base)
      else await createConflictCopy({ group_id: null }, body)
    })
    message.value = '草稿已保存到本机，等待同步。'
  } catch (error) {
    failed.value = true
    message.value = `草稿保存失败：${error instanceof Error ? error.message : String(error)}`
  }
}

const percent = computed(() => {
  const p = progress.value
  if (!p || p.total === 0) return 0
  return Math.round((p.done / p.total) * 100)
})

function stamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

async function runExport() {
  if (busy.value) return
  busy.value = true
  failed.value = false
  message.value = '正在准备导出…'
  try {
    const bundle = await buildBackup((p) => (progress.value = p), 3)
    downloadBlob(bundle.blob, `snotes-backup-${stamp()}.zip`)
    const parts = [`已导出 ${bundle.notes} 条笔记、${bundle.groups} 个分组、${bundle.images} 张图片。`]
    if (bundle.knowledgeBases) parts.push(`${bundle.knowledgeBases} 个笔记本及目录已包含在备份中。`)
    if (bundle.missingImages > 0) {
      // 少图是备份不完整，必须说出来，不能说成「已全部导出」
      parts.push(`其中 ${bundle.missingImages} 张图片下载失败，正文里保留了原地址。`)
      failed.value = true
    }
    message.value = parts.join('')
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? `导出失败：${error.message}` : '导出失败，请稍后重试。'
  } finally {
    busy.value = false
    progress.value = null
  }
}

async function onPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // 允许连续两次选择同一个文件
  if (files.length === 0) return

  busy.value = true
  failed.value = false
  message.value = '正在读取文件…'
  try {
    const result = await importBackup(files, (p) => (progress.value = p))
    const parts = [`已导入 ${result.notes} 条笔记、${result.groups} 个新分组、${result.images} 张图片。`]
    if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 条已存在的笔记。`)
    if (result.noteConflicts) { parts.push(`${result.noteConflicts} 条同 ID 笔记正文不同，已保留现有正文，导入正文可在笔记历史中查看。`); failed.value = true }
    if (result.knowledgeBases) parts.push(`恢复 ${result.knowledgeBases} 个笔记本。`)
    if (result.knowledgeBaseConflicts) { parts.push(`${result.knowledgeBaseConflicts} 个同 ID 笔记本内容不同，已保留现有内容与导入快照。`); failed.value = true }
    if (result.missingReferences) { parts.push(`${result.missingReferences} 个笔记引用缺少正文，目录中保留占位。`); failed.value = true }
    if (result.failedImages > 0) {
      parts.push(`${result.failedImages} 张图片上传失败，正文里保留了相对路径。`)
      failed.value = true
    }
    message.value = parts.join('')
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? `导入失败：${error.message}` : '导入失败，请检查文件后重试。'
  } finally {
    busy.value = false
    progress.value = null
  }
}
</script>

<template>
  <section v-if="failedTasks.length" class="backup-progress failed" role="alert">
    <p>{{ failedTasks.length }} 项改动尚未同步。正文仍保存在本机，可下载任务数据留存；目标已被删除时请另建笔记恢复正文。</p>
    <article v-for="task in failedTasks" :key="task.id">
      <p>{{ task.note_id }} · {{ task.kind }} · {{ task.last_error || '同步失败' }}</p>
      <button class="dialog-btn" @click="downloadFailedTask(task)">下载任务数据</button>
    </article>
    <button class="dialog-btn" :disabled="busy" @click="retryFailedTasks">重试失败任务</button>
  </section>
  <section v-if="unsavedDrafts.length" class="backup-progress failed" role="alert">
    <p>有 {{ unsavedDrafts.length }} 份正文尚未保存到本机。请重试或下载草稿后再关闭页面。</p>
    <article v-for="draft in unsavedDrafts" :key="draft.journalKey">
      <p>{{ draft.body.slice(0, 80) || '空白草稿' }}<span v-if="draft.error"> · {{ draft.error }}</span></p>
      <button class="dialog-btn" @click="recoverDraft(draft.journalKey)">重试保存</button>
      <button class="dialog-btn" @click="downloadMarkdown('未保存草稿', draft.body)">下载草稿</button>
      <button class="dialog-btn" @click="downloadMarkdown('未保存草稿', draft.body); discardDraft(draft.journalKey)">下载并移除草稿</button>
    </article>
  </section>
  <div class="backup-actions">
    <button class="dialog-btn ok" data-action="export" :disabled="busy" @click="runExport">
      <AppIcon name="download" :size="15" />导出全部
    </button>
    <button class="dialog-btn cancel" data-action="import" :disabled="busy" @click="fileInput?.click()">
      <AppIcon name="upload" :size="15" />导入备份
    </button>
    <input
      ref="fileInput"
      class="image-input"
      type="file"
      accept=".md,.markdown,.zip,text/markdown,application/zip"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="onPicked"
    />
  </div>
  <p class="settings-hint">备份包含本机正常笔记、全部回收站笔记、本地正文历史、分组和笔记本。仅在云端的历史需使用服务端实例备份。导入采用合并：本地数据一次提交，失败不写入笔记；同 ID 的不同正文保存在笔记历史中。图片上传失败可能留下云端孤立对象，重试会复用已上传图片。删除笔记不会擦除图片，持有效凭证和图片地址仍可读取。单篇正文上限 1 MiB，一次导入文件上限 100 MiB。</p>

  <p v-if="busy" class="backup-progress" role="status">
    {{ progress?.label ?? '正在处理…' }}
    <span v-if="progress && progress.total > 0">{{ progress.done }}/{{ progress.total }}</span>
    <span class="backup-bar" aria-hidden="true"><span class="backup-bar-fill" :style="{ width: `${percent}%` }"></span></span>
  </p>
  <p v-else-if="message" class="backup-progress" :class="{ failed }" role="status">{{ message }}</p>
</template>
