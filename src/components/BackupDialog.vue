<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDialogFocus } from './useDialogFocus'
import { buildBackup, importBackup, type BackupProgress } from '../export/backup'
import { downloadBlob } from '../export/share'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const progress = ref<BackupProgress | null>(null)
const message = ref('')
const failed = ref(false)

useDialogFocus(() => props.open, panel, () => emit('close'))

watch(
  () => props.open,
  (open) => {
    if (open) {
      busy.value = false
      progress.value = null
      message.value = ''
      failed.value = false
    }
  },
)

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
    const bundle = await buildBackup((p) => (progress.value = p))
    downloadBlob(bundle.blob, `snotes-backup-${stamp()}.zip`)
    const parts = [`已导出 ${bundle.notes} 条笔记、${bundle.groups} 个分组、${bundle.images} 张图片。`]
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
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="$emit('close')">
      <div ref="panel" class="dialog backup-dialog" role="dialog" aria-modal="true" aria-label="导出与导入">
        <h3 class="dialog-title">导出与导入</h3>

        <p class="backup-hint">
          导出的 zip 里，每个分组是一个文件夹、每条笔记是一个 <code>.md</code> 文件，
          图片放在 <code>images/</code> 下并改成相对路径，另外附一份 <code>index.json</code> 记录星标、置顶和颜色。
          这份包可以直接导入回来，也能用别的 Markdown 应用打开。
        </p>

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

        <p v-if="busy" class="backup-progress" role="status">
          {{ progress?.label ?? '正在处理…' }}
          <span v-if="progress && progress.total > 0">{{ progress.done }}/{{ progress.total }}</span>
          <span class="backup-bar" aria-hidden="true"><span class="backup-bar-fill" :style="{ width: `${percent}%` }"></span></span>
        </p>
        <p v-else-if="message" class="backup-progress" :class="{ failed }" role="status">{{ message }}</p>

        <div class="dialog-footer">
          <button class="dialog-btn cancel" @click="$emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
