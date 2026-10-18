<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { countWords } from '../../shared/derive'
import type { KnowledgeBaseMeta } from '../../shared/knowledge-base'
import { homeHiddenGroupIds, isHiddenFromHome } from '../../shared/home-feed'
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
import TableDialog from './TableDialog.vue'
import ImageLightbox from './ImageLightbox.vue'
import { SKIN_COLORS } from './palette'
import { EMPTY_FORMAT_STATE, type FormatState } from '../editor/format'
import { copyMarkdown, downloadMarkdown, shareMarkdown } from '../export/share'
import { importBackup } from '../export/backup'
import { notify } from '../notify'
import { trashDaysLeft, useUiStore } from '../stores/ui'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import { addKnowledgeBaseNode, createKnowledgeBase, changeToc } from '../db/knowledge-base-repo'
import KnowledgeBaseForm from './KnowledgeBaseForm.vue'
import { useMediaQuery } from './useMediaQuery'
import { useWorkspaceScroll } from './useWorkspaceScroll'
import { pushNav, isMobile, showKnowledgeBases } from '../navigation'
import { workspacePreferences as preferences, updateWorkspacePreferences } from '../workspace-preferences'
import DocumentOutline from './DocumentOutline.vue'

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
const outlineOpen = ref(false)
const outlineButton = ref<HTMLButtonElement | null>(null)
function closeOutline() { outlineOpen.value = false; void nextTick(() => outlineButton.value?.focus({ preventScroll: true })) }
watch(() => notes.current, note => { if (!note) editorReady.value = false })

const currentGroup = computed(() => groups.groups.find(group => group.group_id === notes.current?.group_id)?.name ?? '未分组')

/** 笔记只属于一本笔记本；旧备份已有的共享引用保留，不再新增共享。 */
const libraries = useKnowledgeBasesStore()
const memberBooks = computed(() => {
  const id = notes.current?.id
  if (!id) return []
  return libraries.books.filter(book => book.invalid === 0 && libraries.tocs.some(toc => toc.knowledge_base_id === book.id && toc.nodes.some(node => node.kind === 'note' && node.note_id === id)))
})
const addableBooks = computed(() => memberBooks.value.length ? [] : libraries.books.filter(book => book.invalid === 0))
const notebookBusy = ref(false)
const notebookForm = ref(false)

/** 加入调整归属；删除进入回收站并保留恢复所需的位置。 */
async function toggleNotebook(bookId: string, join: boolean) {
  const id = notes.current?.id
  if (!id || notebookBusy.value) return
  if (!join) { if (canEdit.value) { openPop.value = null; await trashCurrent() }; return }
  notebookBusy.value = true
  try {
    editorRef.value?.flush?.()
    const book = libraries.books.find(b => b.id === bookId)
    const nodeId = await addKnowledgeBaseNode(bookId, { kind: 'note', note_id: id, title: null })
    openPop.value = null
    await showKnowledgeBases(bookId)
    ui.activeTocNodeId = nodeId
    notes.currentId = id
    if (isMobile()) ui.mobilePane = 'editor'
    notify(`已加入「${book?.name ?? '笔记本'}」`)
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e))
  } finally { notebookBusy.value = false }
}

/** 现场新建一本笔记本并立刻收录当前笔记，省掉「先建库再回来加入」的往返。 */
async function saveNotebookForm(meta: KnowledgeBaseMeta) {
  const id = notes.current?.id
  if (!id || notebookBusy.value) return
  notebookBusy.value = true
  try {
    editorRef.value?.flush?.()
    const nodeId = crypto.randomUUID()
    const created = await createKnowledgeBase({ ...meta, ord: libraries.books.length }, crypto.randomUUID(), [
      { id: nodeId, kind: 'note', note_id: id, title: null, parent_id: null, ord: 0 },
    ])
    notebookForm.value = false
    await showKnowledgeBases(created.id)
    ui.activeTocNodeId = nodeId
    notes.currentId = id
    if (isMobile()) ui.mobilePane = 'editor'
    notify(`已新建「${created.name}」并加入这条笔记`)
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e))
  } finally { notebookBusy.value = false }
}

/** 「不上首页」的分组集合：判断当前笔记与所属分组的默认值都靠它 */
const hiddenGroups = computed(() => homeHiddenGroupIds(groups.groups))
/** 当前笔记此刻是否不上首页信息流（分组默认 + 笔记覆盖） */
const homeHidden = computed(() => (notes.current ? isHiddenFromHome(notes.current, hiddenGroups.value) : false))
/** 当前笔记是否对首页可见性做过单独设置（有覆盖值），用于菜单文案与恢复入口 */
const homeOverridden = computed(() => notes.current?.home_hidden === 0 || notes.current?.home_hidden === 1)
/** 所属分组是否默认不上首页；有默认值时才谈得上「恢复跟随分组」 */
const groupHidesHome = computed(() => groups.groups.find(g => g.group_id === notes.current?.group_id)?.hide_from_home === 1)

/** 窄屏将字数、阅读与笔记本入口收进更多菜单。 */
const compact = useMediaQuery('(max-width: 720px)')

/**
 * 能改正文的条件：不是回收站详情，也不在阅读模式里。
 * 阅读模式只是「这条笔记现在只读」，退出后照常编辑；回收站的只读是数据状态。
 */
const canEdit = computed(() => !props.readonly && !ui.readingMode)

/**
 * 阅读模式开关。进只读态之前先把编辑器里 debounce 中还没交出去的内容落库——
 * 否则刚敲的最后几个字会被后面的只读判断挡掉，直接丢掉。
 */
async function toggleReading() {
  if (props.readonly) return
  if (!ui.readingMode) editorRef.value?.flush?.()
  ui.readingMode = !ui.readingMode
  if (!ui.readingMode) {
    await nextTick()
    editorBody.value?.querySelector<HTMLElement>('.ProseMirror')?.focus()
  }
}

/** 快捷键走 store 里的请求计数（和删除同一个套路），最终仍然由这里统一处理落盘顺序 */
watch(() => ui.readingRequest, () => { void toggleReading() })

/**
 * 切换当前笔记的首页信息流可见性。分组设置只是默认值，这里是单条笔记的覆盖：
 * 隐藏后它在「全部笔记」里消失，但仍在「已隐藏」、分组和星标视图里。
 */
async function toggleHomeFeed() {
  const note = notes.current
  if (!note) return
  const hide = !homeHidden.value
  await notes.setProps(note.id, { home_hidden: hide ? 1 : 0 })
  notify(hide ? '已设为不上首页，可在「已隐藏」里找到' : '这条笔记已显示在首页信息流')
}

/** 清掉笔记级的覆盖值，重新跟随所属分组的默认设置 */
async function resetHomeFeed() {
  const note = notes.current
  if (!note) return
  // 清掉覆盖值之后这条笔记的可见性就等于所在分组的默认值了
  await notes.setProps(note.id, { home_hidden: null })
  notify('已恢复跟随分组设置')
}

/** 颜色、分组和笔记本浮层一次只展开一个。 */
const openPop = ref<'color' | 'group' | 'notebook' | null>(null)

async function toggle(pop: 'color' | 'group' | 'notebook') {
  menuOpen.value = false
  openPop.value = openPop.value === pop ? null : pop
  if (openPop.value) {
    await nextTick()
    document.querySelector<HTMLButtonElement>('.op-popover button')?.focus()
  }
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  // 菜单是 Teleport 到 body 的，所以点它的条目时 target 不在 .op-wrap 里。
  // 那条路径要先让菜单项自己的动作跑完（比如打开笔记本浮层），这里不能顺手关掉浮层。
  if (target?.closest?.('.action-menu')) return
  if (openPop.value && !target.closest('.op-wrap')) openPop.value = null
}

function onPopoverKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !openPop.value) return
  const trigger = openPop.value
  event.preventDefault()
  event.stopPropagation()
  openPop.value = null
  const focusTarget = document.querySelector<HTMLButtonElement>(`[data-op="${trigger}"]`) ?? moreButton.value
  focusTarget?.focus()
}

/** 顶栏的笔记本浮层要现取「哪几本收录了这条笔记」，所以这里也要订阅笔记本数据。 */
let librarySubscription: ReturnType<typeof libraries.subscribe> | undefined
onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onPopoverKeydown, true)
  librarySubscription = libraries.subscribe()
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onPopoverKeydown, true)
  librarySubscription?.unsubscribe()
})

/** 顶栏更多菜单统一收纳低频文档管理与导入导出。 */
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
    case 'color': openPop.value = 'color'; return
    case 'info': showInfo.value = true; return
    case 'notebooks': if (!props.readonly) openPop.value = 'notebook'; return
    case 'history': showHistory.value = true; return
    case 'wordcount': showWordCount.value = true; return
    case 'reading': await toggleReading(); return
    case 'home-feed': await toggleHomeFeed(); return
    case 'home-follow': await resetHomeFeed(); return
    case 'copy': await runCopy(); return
    case 'download': runDownload(); return
    case 'import': if (canEdit.value && !importing.value) markdownInput.value?.click(); return
    case 'share': await runShare(); return
    case 'print': window.print(); return
    case 'trash': if (canEdit.value) await trashCurrent(); return
  }
}

/** 光标处的格式，由编辑器在选区或文档变化时上报，驱动工具栏点亮 */
const formatState = ref<FormatState>(EMPTY_FORMAT_STATE)

/** 链接弹窗：工具栏的「链接」按钮与正文气泡共用，editing 决定文案与预填内容 */
const linkDialog = ref(false)
const linkDraft = ref({ href: '', text: '', editing: false })

/** 表格弹窗：先收行列数，再交给编辑器的表格命令 */
const tableDialog = ref(false)

function submitTable(payload: { rows: number; cols: number }) {
  tableDialog.value = false
  editorRef.value?.insertTable?.(payload.rows, payload.cols)
}

watch(() => notes.currentId, () => {
  openPop.value = null
  menuOpen.value = false
  formatState.value = EMPTY_FORMAT_STATE
  if (editorBody.value) editorBody.value.scrollTop = 0
}, { flush: 'post' })
useWorkspaceScroll(editorBody, 'editor', () => editorReady.value)

function onFormat(action: ToolbarAction) {
  if (action === 'undo') { editorRef.value?.undo?.(); return }
  if (action === 'redo') { editorRef.value?.redo?.(); return }
  if (action === 'image') { imageInput.value?.click(); return }
  if (action === 'table') {
    tableDialog.value = true
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
  // 注意这里只看回收站只读：切进阅读模式时编辑器里可能还有一次 debounce 中的编辑，
  // 那是用户刚敲的字，必须照常落库，不能因为模式变了就丢掉。
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

/** 每次导入一个 Markdown 文件，新建笔记后打开，沿用设置里的导入逻辑。 */
const markdownInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

async function onMarkdownPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !canEdit.value || importing.value) return
  if (!/\.(md|markdown)$/i.test(file.name)) {
    notify('请选择 .md 或 .markdown 文件')
    return
  }
  importing.value = true
  notify('正在导入 .md…')
  try {
    const result = await importBackup([file])
    const id = result.noteIds[0]
    if (id) {
      pushNav()
      ui.view = 'all'
      ui.activeGroupId = null
      ui.query = ''
      ui.drawerOpen = false
      await notes.load()
      notes.currentId = id
    }
    notify(`已导入 ${result.notes} 条笔记`)
  } catch (error) {
    notify(error instanceof Error ? `导入失败：${error.message}` : '导入失败，请检查文件后重试')
  } finally {
    importing.value = false
  }
}

async function trashCurrent() {
  const id = notes.current?.id
  if (!id) return
  editorRef.value?.flush?.()
  await notes.trashWithUndo(id)
}

async function detachNotebook() {
  const id = notes.current?.id
  if (!id || notebookBusy.value) return
  notebookBusy.value = true
  try {
    editorRef.value?.flush?.()
    for (const book of memberBooks.value) await changeToc(book.id, nodes => nodes.filter(node => node.note_id !== id))
    openPop.value = null
    await notes.load()
    notify('已移出笔记本，可在普通笔记列表中找到')
  } catch (error) { notify(error instanceof Error ? error.message : String(error)) }
  finally { notebookBusy.value = false }
}

/** 永久删除仍需确认。 */
const confirmAction = ref<'purge' | null>(null)

/** 快捷键 Mod Shift D 走 store 里的计数，不依赖顶栏有没有渲染删除按钮 */
watch(() => ui.trashRequest, () => {
  if (canEdit.value && notes.current) void trashCurrent()
})

function runDelete() {
  if (confirmAction.value === 'purge' && notes.current) {
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
  if (!canEdit.value || !notes.current) return
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
      <button v-if="!ui.focusMode" type="button" class="icon-button list-visibility-toggle" :title="preferences.listCollapsed ? '展开笔记列表' : '收起笔记列表'" :aria-label="preferences.listCollapsed ? '展开笔记列表' : '收起笔记列表'" :aria-expanded="!preferences.listCollapsed" aria-controls="workspace-list" @click="updateWorkspacePreferences({ listCollapsed: !preferences.listCollapsed })"><AppIcon name="listPanel" :size="18" /></button>
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

      <!-- 所属笔记本路径与管理入口。 -->
      <!-- 320px 顶栏排不下，窄屏走「⋯」菜单，和文档信息、删除同一个道理 -->
      <div v-if="!readonly && !compact" class="op-wrap">
        <button
          class="editor-location"
          data-op="notebook"
          :class="{ open: openPop === 'notebook' }"
          :title="memberBooks.length ? `已加入 ${memberBooks.length} 本笔记本` : '加入笔记本'"
          aria-label="加入笔记本"
          aria-haspopup="true"
          :aria-expanded="openPop === 'notebook'"
          @click="toggle('notebook')"
        >
          <AppIcon name="book" :size="16" />
          <span>{{ memberBooks.length ? memberBooks[0]?.name : '加入笔记本' }}</span>
          <AppIcon name="chevron" :size="12" class="group-chevron" />
        </button>
      </div>

      <!--
        窄屏的入口在「⋯」菜单里，但这块容器没有跟着一起被 !compact 收掉：
        浮层需要它做定位锚点，收掉就再也渲染不出来了。
      -->
      <div v-if="!readonly" class="op-wrap notebook-wrap">
        <div v-if="openPop === 'notebook'" class="op-popover groups-pop notebook-pop" role="group" aria-label="加入笔记本">
          <span class="popover-heading">加入笔记本</span>
          <p class="notebook-pop-hint">移出后成为独立笔记；删除会移入回收站，恢复后回到原位置。</p>
          <div v-if="memberBooks.length" class="notebook-pop-members">
            <button
              v-for="b in memberBooks"
              :key="b.id"
              type="button"
              class="book-opt member"
              :data-book-id="b.id"
              :disabled="notebookBusy"
              :aria-pressed="true"
              title="从笔记本删除这条笔记"
              @click="toggleNotebook(b.id, false)"
            >
              <AppIcon name="check" :size="14" /><span>{{ b.name }}</span><small>移入回收站</small>
            </button>
          </div>
          <button v-if="memberBooks.length" class="book-opt" :disabled="notebookBusy" @click="detachNotebook"><AppIcon name="back" :size="14" /><span>移出笔记本，转为独立笔记</span></button>
          <p v-if="!memberBooks.length" class="notebook-pop-empty">还没加入任何笔记本</p>
          <div v-if="!memberBooks.length" class="notebook-pop-addable">
            <span v-if="addableBooks.length" class="popover-heading notebook-pop-heading">加入其它笔记本</span>
            <button
              v-for="b in addableBooks"
              :key="b.id"
              type="button"
              class="book-opt addable"
              :data-book-id="b.id"
              :disabled="notebookBusy"
              :aria-pressed="false"
              @click="toggleNotebook(b.id, true)"
            >
              <AppIcon name="plus" :size="14" /><span>{{ b.name }}</span>
            </button>
            <button type="button" class="book-opt" data-book-id="__new" :disabled="notebookBusy" @click="notebookForm = true; openPop = null">
              <AppIcon name="plus" :size="14" /><span>新建笔记本并加入</span>
            </button>
          </div>
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
          <span class="op-separator words-separator" aria-hidden="true"></span>
          <button class="op-btn op-words" data-op="wordcount" title="字数统计" aria-label="字数统计" @click="showWordCount = true">{{ wordCount.words }} 字</button>
        </template>

        <span class="op-separator" aria-hidden="true"></span>
        <button class="op-btn focus-toggle" data-op="focus" :class="{ selected: ui.focusMode }" :aria-pressed="ui.focusMode" :title="ui.focusMode ? '退出专注模式 (Esc)' : '专注模式'" :aria-label="ui.focusMode ? '退出专注模式' : '专注模式'" @click="toggleFocus">
          <AppIcon :name="ui.focusMode ? 'collapse' : 'focus'" />
        </button>

        <!-- 阅读模式：正文只读，读文章时怎么点怎么划都改不坏内容。
             ≤720px 顶栏没有余量，这颗按钮和删除一样让位给「⋯」菜单。 -->
        <button
          v-if="!compact"
          class="op-btn reading-toggle"
          data-op="reading"
          :class="{ selected: ui.readingMode }"
          :aria-pressed="ui.readingMode"
          :title="ui.readingMode ? '退出阅读模式 (Esc)' : '阅读模式：正文只读 (Ctrl/⌘ Shift E)'"
          :aria-label="ui.readingMode ? '退出阅读模式' : '阅读模式'"
          @click="toggleReading"
        >
          <AppIcon :name="ui.readingMode ? 'edit' : 'book'" />
        </button>

        <button ref="outlineButton" type="button" class="op-btn" data-op="outline" :class="{ selected: outlineOpen }" title="笔记大纲" aria-label="笔记大纲" aria-controls="document-outline" :aria-expanded="outlineOpen" @click="outlineOpen ? closeOutline() : outlineOpen = true"><AppIcon name="outline" /></button>
        <button ref="moreButton" class="op-btn" data-op="more" :class="{ open: menuOpen }" title="更多操作" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click="toggleMenu">
          <AppIcon name="more" />
        </button>
      </div>
    </div>

    <!-- 编辑工具栏独立一行：顶栏在 320px 已经排满，塞不下十几个格式按钮 -->
    <FormatToolbar v-if="canEdit && notes.current" :state="formatState" @action="onFormat" />
    <input v-if="canEdit" ref="imageInput" class="image-input" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" @change="onImagePicked" />

    <!-- 阅读模式提示条：占位不高但足够显眼，点一下或按 Esc 就退出 -->
    <div v-if="!readonly && ui.readingMode && notes.current" class="reading-banner" role="status">
      <AppIcon name="book" :size="15" />
      <span>阅读模式 · 正文只读，不会误改</span>
      <button type="button" class="reading-exit" @click="toggleReading">退出 (Esc)</button>
    </div>

    <div class="editor-stage">
    <div ref="editorBody" class="editor-body" :class="{ 'is-reading': !readonly && ui.readingMode }">
      <div v-if="!notes.current && !readonly" class="editor-welcome">
        <div class="welcome-pages" aria-hidden="true"><AppIcon name="note" :size="46" /></div>
        <span class="welcome-eyebrow">你的想法，值得被记下</span>
        <h1>留一点空间给思考</h1>
        <p>选择左侧的笔记继续，或从一页空白开始。</p>
        <button type="button" class="welcome-create" @click="notes.create()"><AppIcon name="plus" :size="16" />写下第一行</button>
        <span class="welcome-shortcut"><kbd>Alt N</kbd> 新建笔记 <span>·</span> <kbd>Ctrl / ⌘ K</kbd> 搜索</span>
      </div>
      <MilkdownEditor
        v-else-if="notes.current"
        ref="editorRef"
        :note-id="notes.current.id"
        :model-value="notes.current.body"
        :editable="canEdit"
        @update:model-value="onBody"
        @flush="onFlush"
        @format-state="formatState = $event"
        @edit-link="onEditLink"
        @open-lightbox="openLightbox"
        @notice="notify"
        @ready="editorReady = true"
      />
    </div>
    <DocumentOutline v-if="outlineOpen && notes.current" :root="editorBody" @close="closeOutline" />
    </div>

    <NoteMenu
      v-if="!readonly"
      :open="menuOpen"
      :anchor="moreButton"
      :can-share="canShare"
      :show-delete="canEdit"
      :show-doc-items="true"
      :show-notebooks="true"
      :notebook-count="memberBooks.length"
      :importing="importing"
      :home-hidden="homeHidden"
      :can-follow-group="homeOverridden && groupHidesHome"
      :show-reading="compact"
      :reading="ui.readingMode"
      @action="onMenuAction"
      @close="menuOpen = false"
    />

    <input v-if="canEdit" ref="markdownInput" class="image-input" data-input="markdown" type="file" accept=".md,.markdown,text/markdown" tabindex="-1" aria-hidden="true" @change="onMarkdownPicked" />

    <!-- 永久删除不可恢复，保留确认弹窗。 -->
    <ConfirmDialog
      :open="confirmAction !== null"
      title="彻底删除这条笔记？"
      message="彻底删除后无法恢复，请谨慎操作。"
      confirm-text="彻底删除"
      @confirm="runDelete"
      @cancel="confirmAction = null"
    />

    <NoteInfoDialog :open="showInfo" :note="notes.current" @close="showInfo = false" />
    <!-- 顶栏浮层里「新建笔记本并加入」复用笔记本表单，保存后直接收录当前笔记 -->
    <KnowledgeBaseForm :open="notebookForm" :busy="notebookBusy" @save="saveNotebookForm" @close="notebookForm = false" />
    <HistoryDialog :open="showHistory" :note="notes.current" :readonly="!canEdit" @close="showHistory = false" @restore="onRestoreHistory" />
    <WordCountDialog :open="showWordCount" :count="wordCount" @close="showWordCount = false" />
    <TableDialog :open="tableDialog" @submit="submitTable" @close="tableDialog = false" />
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

<style scoped>
/*
 * 笔记本浮层：沿用分组浮层的外观，但每行要能同时表达「已加入」和「可加入」两种状态。
 * 这里只写 .book-opt / .notebook-pop，不动全局的 .group-opt，避免影响分组浮层。
 */
.notebook-pop { width: min(240px, calc(100vw - 48px)); }
/*
 * 窄屏时这颗按钮不渲染，.notebook-wrap 只剩一个零宽的锚点、又贴在顶栏右侧；
 * 默认的 right: 0 会把浮层整块推到屏幕左边。改成以锚点左缘为起点、整体右移一点。
 * 锚点必须保留定位（position: relative 来自 .op-wrap）：改成 static 会让浮层
 * 转而相对文档定位，直接掉到首屏之外。
 */
.notebook-wrap .notebook-pop { right: auto; left: 0; transform: translateX(6px); }
.notebook-pop-hint { margin: 0 0 4px; padding: 0 10px 8px; border-bottom: 1px solid var(--border-light); color: var(--text-tertiary); font-size: 11px; line-height: 1.6; }
.notebook-pop-heading { margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--border-light); }
.notebook-pop-empty { margin: 0; padding: 6px 10px; color: var(--text-tertiary); font-size: 12px; }
.book-opt { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--text-primary); font-size: 13px; text-align: left; }
.book-opt:hover:not(:disabled) { background: var(--bg-hover); }
.book-opt:disabled { opacity: .5; }
.book-opt .app-icon { flex: none; }
.book-opt span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.book-opt small { margin-left: auto; padding-left: 8px; color: var(--text-tertiary); font-size: 11px; white-space: nowrap; }
.book-opt.addable { color: var(--text-secondary); }
</style>
