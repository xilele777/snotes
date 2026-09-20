<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { countWords } from '../../shared/derive'
import type MilkdownEditorComponent from '../editor/MilkdownEditor.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import ConfirmDialog from './ConfirmDialog.vue'
import HistoryDialog from './HistoryDialog.vue'
import NoteInfoDialog from './NoteInfoDialog.vue'
import NoteMenu, { type NoteMenuAction } from './NoteMenu.vue'
import WordCountDialog from './WordCountDialog.vue'
import AppIcon from './AppIcon.vue'
import EditorLoading from './EditorLoading.vue'
import FormatToolbar, { type ToolbarAction } from './FormatToolbar.vue'
import LinkDialog from './LinkDialog.vue'
import ImageLightbox from './ImageLightbox.vue'
import { SKIN_COLORS } from './palette'
import { EMPTY_FORMAT_STATE, type FormatState } from '../editor/format'
import { copyMarkdown, downloadMarkdown, shareMarkdown } from '../export/share'
import { notify } from '../notify'
import { trashDaysLeft, useUiStore } from '../stores/ui'
import { useMediaQuery } from './useMediaQuery'
import { useWorkspaceScroll } from './useWorkspaceScroll'

const MilkdownEditor = defineAsyncComponent({
  loader: () => import('../editor/MilkdownEditor.vue'),
  loadingComponent: EditorLoading,
  delay: 120,
})

const props = withDefaults(defineProps<{ readonly?: boolean }>(), { readonly: false })
defineEmits<{ back: [] }>()

const notes = useNotesStore()
const groups = useGroupsStore()
const ui = useUiStore()
const editorBody = ref<HTMLElement | null>(null)
const editorReady = ref(false)
watch(() => notes.current, note => { if (!note) editorReady.value = false })

const currentGroup = computed(() => groups.groups.find(group => group.group_id === notes.current?.group_id)?.name ?? '未分组')

/** ≤720px 的顶栏放不下删除按钮，删除挪进「更多」菜单；字数、文档信息、历史版本同样只在桌面直接放顶栏 */
const compact = useMediaQuery('(max-width: 720px)')

/** 颜色和分组浮层一次只展开一个。 */
const openPop = ref<'color' | 'group' | null>(null)

async function toggle(pop: 'color' | 'group') {
  menuOpen.value = false
  openPop.value = openPop.value === pop ? null : pop
  if (openPop.value) {
    await nextTick()
    document.querySelector<HTMLButtonElement>('.op-popover button')?.focus()
  }
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (openPop.value && !target.closest('.op-wrap')) openPop.value = null
}

function onPopoverKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !openPop.value) return
  const trigger = openPop.value
  event.preventDefault()
  event.stopPropagation()
  openPop.value = null
  document.querySelector<HTMLButtonElement>(`[data-op="${trigger}"]`)?.focus()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onPopoverKeydown, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onPopoverKeydown, true)
})

/** 顶栏「⋯」菜单（回收站里没有）：收拢复制、下载、分享、打印，手机上还有文档信息、历史、字数与删除 */
const moreButton = ref<HTMLButtonElement | null>(null)
const menuOpen = ref(false)

function toggleMenu() {
  openPop.value = null
  menuOpen.value = !menuOpen.value
}

/** 系统分享面板只在支持的浏览器里给入口，不支持时复制与下载已经够用 */
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

async function onMenuAction(action: NoteMenuAction) {
  menuOpen.value = false
  // 先把焦点交还给 ⋯，随后打开的弹窗会记住它，关闭后焦点仍回到顶栏
  moreButton.value?.focus({ preventScroll: true })
  switch (action) {
    case 'info': showInfo.value = true; return
    case 'history': showHistory.value = true; return
    case 'wordcount': showWordCount.value = true; return
    case 'copy': await runCopy(); return
    case 'download': runDownload(); return
    case 'share': await runShare(); return
    case 'print': window.print(); return
    case 'trash': if (!props.readonly) confirmAction.value = 'trash'; return
  }
}

/** 光标处的格式，由编辑器在选区或文档变化时上报，驱动工具栏点亮 */
const formatState = ref<FormatState>(EMPTY_FORMAT_STATE)

/** 链接弹窗：工具栏的「链接」按钮与正文气泡共用，editing 决定文案与预填内容 */
const linkDialog = ref(false)
const linkDraft = ref({ href: '', text: '', editing: false })

watch(() => notes.currentId, () => {
  openPop.value = null
  menuOpen.value = false
  formatState.value = EMPTY_FORMAT_STATE
  if (editorBody.value) editorBody.value.scrollTop = 0
}, { flush: 'post' })
useWorkspaceScroll(editorBody, 'editor', () => editorReady.value)

function onFormat(action: ToolbarAction) {
  if (action === 'table') {
    editorRef.value?.insertTable?.()
    return
  }
  if (action === 'link') {
    const existing = editorRef.value?.currentLink?.() ?? null
    linkDraft.value = {
      href: existing?.href ?? '',
      text: existing?.text ?? editorRef.value?.selectedText?.() ?? '',
      editing: existing !== null,
    }
    linkDialog.value = true
    return
  }
  editorRef.value?.format?.(action)
}

function submitLink(payload: { href: string; text: string }) {
  linkDialog.value = false
  editorRef.value?.setLinkAt?.(payload.href, payload.text)
}

/** 正文气泡里的「编辑」：带着这条链接的地址与文字打开弹窗 */
function onEditLink(href: string) {
  const current = editorRef.value?.currentLink?.() ?? null
  linkDraft.value = { href, text: current?.text ?? '', editing: true }
  linkDialog.value = true
}

function onBody(md: string, base: string) {
  if (props.readonly) return
  if (notes.current) notes.saveBody(notes.current.id, md, base)
}

function onFlush(id: string, md: string, base: string) {
  if (props.readonly) return
  notes.saveBody(id, md, base)
}

/** 触发编辑器里的撤销/重做（history 插件）；只读态顶栏不渲染这两个钮，为空安全 */
const editorRef = ref<InstanceType<typeof MilkdownEditorComponent> | null>(null)

async function toggleFocus() {
  ui.focusMode = !ui.focusMode
  await nextTick()
  editorBody.value?.querySelector<HTMLElement>('.ProseMirror')?.focus()
}

/** 隐藏的图片文件选择器：手机端没有可靠的粘贴图片途径，顶栏按钮触发它 */
const imageInput = ref<HTMLInputElement | null>(null)

function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // 先清空再插入：不清空的话再次选同一张图不会触发 change
  input.value = ''
  if (files.length > 0) editorRef.value?.insertImages?.(files)
}

/** 删除动作统一定点到这个弹窗；null = 未打开 */
const confirmAction = ref<'trash' | 'purge' | null>(null)

/** 快捷键 Mod Shift D 走 store 里的计数，不依赖顶栏有没有渲染删除按钮 */
watch(() => ui.trashRequest, () => {
  if (!props.readonly && notes.current) confirmAction.value = 'trash'
})

function runDelete() {
  if (confirmAction.value === 'trash' && notes.current) {
    notes.trash(notes.current.id)
  } else if (confirmAction.value === 'purge' && notes.current) {
    notes.purge(notes.current.id)
  }
  confirmAction.value = null
}

/** 文档信息 / 历史版本 / 字数统计弹窗开关 */
const showInfo = ref(false)
const showHistory = ref(false)
const showWordCount = ref(false)

/** 历史弹窗里的「恢复」：当前正文先存为快照再被替换，编辑器随 modelValue 刷新 */
async function onRestoreHistory(body: string) {
  if (props.readonly || !notes.current) return
  const ok = await notes.restoreHistory(notes.current.id, body)
  notify(ok ? '已恢复到所选版本，之前的正文已存入历史' : '这条笔记已不存在')
}

/** 图片灯箱状态 */
const lightboxOpen = ref(false)
const lightboxImages = ref<string[]>([])
const lightboxIndex = ref(0)

function openLightbox(images: string[], index: number) {
  lightboxImages.value = images
  lightboxIndex.value = index
  lightboxOpen.value = true
}

function closeLightbox() {
  lightboxOpen.value = false
}

/** 回收站详情顶栏的说明：按服务端保留天数算还剩几天，关闭了自动清理就只说在回收站中 */
const trashNotice = computed(() => {
  const note = notes.current
  if (!note) return ''
  const left = trashDaysLeft(note.update_time, ui.trashRetentionDays)
  return left === null ? '此笔记在回收站中' : `此笔记还有 ${left} 天被删除`
})

/** 当前笔记字数统计（实时随正文变化） */
const wordCount = computed(() => countWords(notes.current?.body ?? ''))

function noteTitle(): string {
  return notes.current?.title || '无标题'
}

async function runCopy() {
  if (!notes.current) return
  const copied = await copyMarkdown(notes.current.body)
  notify(copied ? '已复制 Markdown' : '复制失败，请在正文里手动选择')
}

function runDownload() {
  if (!notes.current) return
  downloadMarkdown(noteTitle(), notes.current.body)
  notify('已开始下载 .md')
}

async function runShare() {
  if (!notes.current) return
  const outcome = await shareMarkdown(noteTitle(), notes.current.body)
  // 用户取消分享时不再弹提示，那是他刚做出的选择
  if (outcome !== 'failed') notify(outcome === 'shared' ? '已分享' : '已复制 Markdown')
}
</script>

<template>
  <main class="editor-pane">
    <div v-if="notes.current" class="editor-top-bar">
      <!-- 移动端返回按钮，仅 <720px 显示 -->
      <button class="back-btn" title="返回列表" aria-label="返回列表" @click="$emit('back')">
        <AppIcon name="back" :size="20" />
      </button>

      <div v-if="!readonly" class="op-wrap editor-group">
        <button
          class="editor-location"
          data-op="group"
          :class="{ open: openPop === 'group' }"
          :title="`移至分组：${currentGroup}`"
          aria-label="移至分组"
          aria-haspopup="true"
          :aria-expanded="openPop === 'group'"
          @click="toggle('group')"
        >
          <AppIcon name="folder" :size="16" />
          <span>{{ currentGroup }}</span>
          <AppIcon name="chevron" :size="12" class="group-chevron" />
        </button>

        <div v-if="openPop === 'group'" class="op-popover groups-pop" role="group" aria-label="选择分组">
          <span class="popover-heading">移至分组</span>
          <button
            class="group-opt"
            :class="{ selected: notes.current.group_id === null }"
            :aria-pressed="notes.current.group_id === null"
            @click="notes.current && notes.setProps(notes.current.id, { group_id: null }); openPop = null"
          >
            未分组
          </button>
          <button
            v-for="g in groups.groups"
            :key="g.group_id"
            class="group-opt"
            :class="{ selected: notes.current.group_id === g.group_id }"
            :aria-pressed="notes.current.group_id === g.group_id"
            @click="notes.current && notes.setProps(notes.current.id, { group_id: g.group_id }); openPop = null"
          >
            {{ g.name }}
          </button>
        </div>
      </div>

      <!-- 回收站详情：只读，只剩恢复 / 彻底删除两个动作，顶栏说明还有几天被自动删除 -->
      <template v-if="readonly">
        <span v-if="notes.current" class="trash-notice">{{ trashNotice }}</span>
        <div v-if="notes.current" class="op-bar">
          <button class="trash-op recover" data-op="recover" @click="notes.recover(notes.current.id)">恢复</button>
          <button class="trash-op purge" data-op="purge" @click="confirmAction = 'purge'">彻底删除</button>
        </div>
      </template>

      <!-- 常用操作直接可见，分组入口同时显示当前位置；低频操作收进最右的「⋯」。 -->
      <div v-else-if="notes.current" class="op-bar">
        <button class="op-btn" data-op="undo" title="撤销 (Ctrl+Z)" aria-label="撤销" @click="editorRef?.undo?.()">
          <AppIcon name="undo" />
        </button>

        <button class="op-btn" data-op="redo" title="重做 (Ctrl+Y)" aria-label="重做" @click="editorRef?.redo?.()">
          <AppIcon name="redo" />
        </button>

        <button class="op-btn" data-op="image" title="插入图片" aria-label="插入图片" @click="imageInput?.click()">
          <AppIcon name="image" />
        </button>
        <input ref="imageInput" class="image-input" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" @change="onImagePicked" />

        <span class="op-separator" aria-hidden="true"></span>

        <button
          class="op-btn"
          data-op="top"
          :class="{ selected: notes.current.top === 1 }"
          :title="notes.current.top === 1 ? '取消置顶' : '置顶'"
          :aria-label="notes.current.top === 1 ? '取消置顶' : '置顶'"
          :aria-pressed="notes.current.top === 1"
          @click="notes.setProps(notes.current.id, { top: notes.current.top === 1 ? 0 : 1 })"
        >
          <AppIcon name="pin" />
        </button>

        <button
          class="op-btn"
          data-op="star"
          :class="{ selected: notes.current.star === 1 }"
          :title="notes.current.star === 1 ? '取消星标' : '星标'"
          :aria-label="notes.current.star === 1 ? '取消星标' : '星标'"
          :aria-pressed="notes.current.star === 1"
          @click="notes.setProps(notes.current.id, { star: notes.current.star === 1 ? 0 : 1 })"
        >
          <AppIcon name="star" />
        </button>

        <div class="op-wrap">
          <button
            class="op-btn"
            data-op="color"
            :class="{ open: openPop === 'color' }"
            title="标记颜色"
            aria-label="标记颜色"
            aria-haspopup="true"
            :aria-expanded="openPop === 'color'"
            @click="toggle('color')"
          >
            <span
              class="op-dot"
              :class="{ 'is-none': !notes.current.skin_color }"
              :style="notes.current.skin_color ? { backgroundColor: notes.current.skin_color } : undefined"
            />
          </button>

          <div v-if="openPop === 'color'" class="op-popover colors" role="group" aria-label="选择标记颜色">
            <button
              v-for="color in SKIN_COLORS"
              :key="color ?? 'none'"
              class="more-swatch"
              :class="{ 'is-none': color === null }"
              :aria-pressed="notes.current.skin_color === color"
              :style="color ? { backgroundColor: color } : undefined"
              :title="color ? '标记颜色' : '清除颜色'"
              :aria-label="color ? `标记颜色 ${color}` : '清除颜色'"
              @click="notes.current && notes.setProps(notes.current.id, { skin_color: color }); openPop = null"
            />
          </div>
        </div>

        <template v-if="!compact">
          <span class="op-separator" aria-hidden="true"></span>
          <button class="op-btn op-words" data-op="wordcount" title="字数统计" aria-label="字数统计" @click="showWordCount = true">{{ wordCount.words }} 字</button>
          <button class="op-btn" data-op="info" title="文档信息" aria-label="文档信息" @click="showInfo = true"><AppIcon name="info" /></button>
          <button class="op-btn" data-op="history" title="历史版本" aria-label="历史版本" @click="showHistory = true"><AppIcon name="clock" /></button>
        </template>

        <span class="op-separator" aria-hidden="true"></span>
        <button class="op-btn focus-toggle" data-op="focus" :class="{ selected: ui.focusMode }" :aria-pressed="ui.focusMode" :title="ui.focusMode ? '退出专注模式 (Esc)' : '专注模式'" :aria-label="ui.focusMode ? '退出专注模式' : '专注模式'" @click="toggleFocus">
          <AppIcon :name="ui.focusMode ? 'collapse' : 'focus'" />
        </button>

        <!-- 320px 顶栏没有余量：手机上删除让位给 ⋯，从菜单或列表左滑删除 -->
        <button
          v-if="!compact"
          class="op-btn danger"
          data-op="trash"
          title="删除"
          aria-label="删除"
          @click="confirmAction = 'trash'"
        >
          <AppIcon name="trash" />
        </button>

        <button ref="moreButton" class="op-btn" data-op="more" :class="{ open: menuOpen }" title="更多操作" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click="toggleMenu">
          <AppIcon name="more" />
        </button>
      </div>
    </div>

    <!-- 编辑工具栏独立一行：顶栏在 320px 已经排满，塞不下十几个格式按钮 -->
    <FormatToolbar v-if="!readonly && notes.current" :state="formatState" @action="onFormat" />

    <div ref="editorBody" class="editor-body">
      <div v-if="!notes.current && !readonly" class="editor-welcome">
        <AppIcon name="note" :size="40" class="empty-art" />
        <h1>选择一条笔记</h1>
        <button class="welcome-create" @click="notes.create()"><AppIcon name="plus" :size="17" />新建笔记</button>
      </div>
      <MilkdownEditor
        v-else-if="notes.current"
        ref="editorRef"
        :note-id="notes.current.id"
        :model-value="notes.current.body"
        :editable="!readonly"
        @update:model-value="onBody"
        @flush="onFlush"
        @format-state="formatState = $event"
        @edit-link="onEditLink"
        @open-lightbox="openLightbox"
        @notice="notify"
        @ready="editorReady = true"
      />
    </div>

    <NoteMenu
      v-if="!readonly"
      :open="menuOpen"
      :anchor="moreButton"
      :can-share="canShare"
      :show-delete="compact"
      :show-doc-items="compact"
      @action="onMenuAction"
      @close="menuOpen = false"
    />

    <!-- 删除统一先确认：移入回收站可恢复，彻底删除不可恢复 -->
    <ConfirmDialog
      :open="confirmAction !== null"
      :title="confirmAction === 'purge' ? '彻底删除这条笔记？' : '删除这条笔记？'"
      :message="confirmAction === 'purge' ? '彻底删除后无法恢复，请谨慎操作。' : '笔记会移入回收站，可随时恢复。'"
      :confirm-text="confirmAction === 'purge' ? '彻底删除' : '删除'"
      @confirm="runDelete"
      @cancel="confirmAction = null"
    />

    <NoteInfoDialog :open="showInfo" :note="notes.current" @close="showInfo = false" />
    <HistoryDialog :open="showHistory" :note="notes.current" :readonly="readonly" @close="showHistory = false" @restore="onRestoreHistory" />
    <WordCountDialog :open="showWordCount" :count="wordCount" @close="showWordCount = false" />
    <LinkDialog
      :open="linkDialog"
      :href="linkDraft.href"
      :text="linkDraft.text"
      :editing="linkDraft.editing"
      @submit="submitLink"
      @close="linkDialog = false"
    />
    <ImageLightbox
      :open="lightboxOpen"
      :images="lightboxImages"
      :initial-index="lightboxIndex"
      @close="closeLightbox"
    />
  </main>
</template>
