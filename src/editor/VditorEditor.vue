<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import './vditor.css'
import { escapeRawHtml, migrateLegacyBr } from '../../shared/sanitize'
import TableDialog from '../components/TableDialog.vue'
import EditorLoading from '../components/EditorLoading.vue'
import { loadVditorAssets } from './vditor-assets'
import { isAllowedImage, MAX_BYTES, uploadImage } from './image-upload'
import { VDITOR_CDN, LARGE_DOCUMENT_CHARS, editorMode, rememberEditorMode } from './vditor-options'
import { markdownFromClipboard } from './markdown-clipboard'
import { tableMarkdown } from './table'

const props = defineProps<{ noteId: string; modelValue: string; editable?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [string, string]
  flush: [string, string, string]
  notice: [string]
  'open-lightbox': [string[], number]
  ready: []
}>()
const root = ref<HTMLElement | null>(null)
let editor: Vditor | undefined
let ready = false
const initialized = ref(false)
const loadError = ref('')
let automaticSource = false
const longDocumentNotice = ref(false)
let disposed = false
let replacing = false
let documentId = props.noteId
let lifetime = 0
// Keep the database baseline separate from Vditor's normalized Markdown.
// Merely opening a note must not rewrite it or create a sync conflict.
let base = props.modelValue
let observed = ''
let pending: string | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let observer: MutationObserver | undefined
let contentObserver: MutationObserver | undefined
let controlsFrame: number | undefined
let controlsNeedUpdate = false
let observedMode: string | undefined
let historyValue = ''
let forwardingPaste = false
const tableOpen = ref(false)
// 弹窗打开时编辑器会失焦，先记住插入位置，提交后再还原。
let tableSelection: Range | undefined
let tableTextarea: { start: number; end: number } | undefined

function clearTimer() {
  clearTimeout(timer)
  timer = undefined
}

function handOff(flushing: boolean) {
  clearTimer()
  if (pending === undefined) return
  const value = pending
  const previous = base
  pending = undefined
  base = value
  if (flushing) emit('flush', documentId, value, previous)
  else emit('update:modelValue', value, previous)
}

function capture(value = ready ? editor?.getValue() : undefined) {
  if (!ready || disposed || replacing || value === undefined || value === observed) return
  observed = value
  pending = value === base ? undefined : value
  clearTimer()
  if (pending !== undefined) timer = setTimeout(() => handOff(false), 800)
}

function flush() {
  // Read the live DOM: Vditor's input callback itself is debounced.
  capture()
  handOff(true)
}

function replace(markdown: string, resetHistory: boolean) {
  if (!editor || !ready) return
  replacing = true
  try {
    editor.setValue(escapeRawHtml(migrateLegacyBr(markdown)), resetHistory)
    observed = editor.getValue()
    historyValue = observed
  } finally {
    replacing = false
  }
}

watch(() => [props.noteId, props.modelValue] as const, ([id, value]) => {
  if (id === documentId) {
    // A save echo must not reset the caret, undo stack or pending input.
    if (value === base) return
    capture()
    // Retain the original baseline so repo.updateBody can save a conflict copy.
    if (pending !== undefined) return
  } else {
    flush()
  }
  lifetime++
  documentId = id
  base = value
  pending = undefined
  clearTimer()
  replace(value, true)
  applyEditable()
  if (!value.trim() && props.editable !== false) focus()
})

function applyEditable() {
  if (!ready || !editor) return
  if (props.editable === false) {
    flush()
    editor.disabled()
  } else editor.enable()
  editor.updateToolbarConfig({ hide: props.editable === false, pin: true })
  updateContentControls()
}
function updateContentControls() {
  root.value?.querySelectorAll<HTMLElement>('.vditor-reset[contenteditable], textarea.vditor-sv').forEach(element => {
    element.setAttribute('role', 'textbox')
    element.setAttribute('aria-label', '笔记正文')
    element.setAttribute('aria-multiline', 'true')
  })
  // Disabled Vditor still permits checkbox clicks through its own handlers.
  root.value?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
    input.disabled = props.editable === false
  })
}
watch(() => props.editable, applyEditable)

function onInput(event: Event) {
  if (event instanceof InputEvent && event.isComposing) return
  // Serializing the entire rich-text DOM on every keystroke is expensive.
  // Vditor's debounced callback captures Markdown; flush() still reads the live
  // DOM for immediate navigation/pagehide, so the last keystroke stays safe.
  if (ready && editor && props.editable !== false) {
    root.value?.querySelector('[data-type="undo"]')?.classList.remove('vditor-menu--disabled')
    root.value?.querySelector('[data-type="redo"]')?.classList.add('vditor-menu--disabled')
  }
}

function onPaste(event: ClipboardEvent) {
  if (forwardingPaste) return
  if (!ready || !editor || props.editable === false || !event.clipboardData
    || event.clipboardData.files.length || editor.getCurrentMode() === 'sv') return
  const target = event.target instanceof Element ? event.target : null
  const selectionNode = window.getSelection()?.anchorNode
  const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement
  const editableRoot = target?.closest('.vditor-reset[contenteditable="true"]')
  const code = selectionElement?.closest('pre, code, [data-type="code-block"]')
  if (!editableRoot || (code && code !== editableRoot)) return
  const html = event.clipboardData.getData('text/html')
  if (/<ol\b/i.test(html) && /<li\b[\s\S]*?<ol\b/i.test(html)) {
    const markdown = editor.vditor.lute.HTML2Md(html.replace(/(<ol\b[^>]*\bstart\s*=\s*)(["'])\s*\2/gi, '$1"1"'))
    const lines = markdown.split('\n')
    // A nested list starting above 1 cannot interrupt a paragraph in CommonMark.
    // Lute's HTML conversion omits the required blank before that child list.
    const normalized = lines.flatMap((line, index) => {
      const match = line.match(/^( +)\d+[.)] /)
      const previous = lines[index - 1] ?? ''
      return match && previous.trim() && match[1].length > (previous.match(/^ */)?.[0].length ?? 0)
        ? ['', line] : [line]
    }).join('\n')
    event.preventDefault()
    event.stopPropagation()
    editor.insertMD(escapeRawHtml(normalized))
    capture()
    return
  }
  if (/<ol\b[^>]*\bstart\s*=\s*(["'])\s*\1/i.test(html)) {
    const clipboardData = new DataTransfer()
    for (const type of event.clipboardData.types) clipboardData.setData(type, event.clipboardData.getData(type))
    clipboardData.setData('text/html', html.replace(/(<ol\b[^>]*\bstart\s*=\s*)(["'])\s*\2/gi, '$1"1"'))
    event.preventDefault()
    event.stopPropagation()
    forwardingPaste = true
    try { event.target?.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })) }
    finally { forwardingPaste = false }
    return
  }
  const markdown = markdownFromClipboard(event.clipboardData)
  if (!markdown) return
  event.preventDefault()
  event.stopPropagation()
  editor.insertMD(escapeRawHtml(markdown))
  capture()
}

function applyTheme() {
  if (!ready || !editor) return
  const dark = document.documentElement.dataset.theme === 'dark'
  editor.setTheme(dark ? 'dark' : 'classic', dark ? 'dark' : 'light', dark ? 'github-dark' : 'github', `${VDITOR_CDN}/dist/css/content-theme`)
}

function focus() {
  if (ready && props.editable !== false) editor?.focus()
}

function runHistory(action: 'undo' | 'redo') {
  if (!ready || !editor || props.editable === false) return
  const instance = editor.vditor
  // Vditor groups typing for 800ms. Commit that pending group before using
  // history, otherwise an immediate undo is ignored or skips the latest text.
  clearTimeout(instance.wysiwyg?.afterRenderTimeoutId)
  clearTimeout(instance.ir?.processTimeoutId)
  clearTimeout(instance.sv?.processTimeoutId)
  if (editor.getValue() !== historyValue) instance.undo?.addToUndoStack(instance)
  instance.undo?.[action](instance)
  historyValue = editor.getValue()
  capture(historyValue)
}

function onHistoryKeydown(event: KeyboardEvent) {
  if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (!target?.closest('.vditor-reset[contenteditable="true"], textarea.vditor-sv')) return
  const key = event.key.toLowerCase()
  if (key === 'k' && !event.shiftKey && editor?.getCurrentMode() === 'wysiwyg') {
    const node = window.getSelection()?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    root.value?.querySelector('[data-type="link"]')?.classList.toggle('vditor-menu--current', !!element?.closest('a'))
    return
  }
  const action = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && !event.shiftKey ? 'redo' : null
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  runHistory(action)
}
function highlight() {
  if (!editor || !ready || props.editable === false) return
  // Rich-text selection serializes a whole paragraph with a trailing newline;
  // placing the closing == after it produces plain text instead of a mark.
  const selected = editor.getSelection().trim() || '\u200b'
  editor.insertMD(selected.split('\n').map(line => line.trim() ? `==${line}==` : line).join('\n'))
  capture()
}
async function insertImages(files: File[]): Promise<null> {
  if (!ready || !editor || disposed || props.editable === false) return null
  const instance = editor
  const id = documentId
  const generation = lifetime
  const mode = instance.getCurrentMode()
  const selection = window.getSelection()
  const range = selection?.rangeCount && root.value?.contains(selection.anchorNode)
    ? selection.getRangeAt(0).cloneRange() : undefined
  const textarea = root.value?.querySelector<HTMLTextAreaElement>('.vditor-sv')
  const start = textarea?.selectionStart
  const end = textarea?.selectionEnd
  const valid = () => !disposed && generation === lifetime && id === documentId
    && props.editable !== false && editor === instance
  const rejected = files.filter(file => !isAllowedImage(file))
  if (rejected.length) emit('notice', `有 ${rejected.length} 个文件未插入：仅支持 10MB 以内的 JPG、PNG、GIF、WebP 图片`)
  const uploaded: string[] = []
  for (const file of files.filter(isAllowedImage)) {
    if (!valid()) break
    try {
      const { url } = await uploadImage(file, id)
      if (!valid()) break
      // Insert only permanent URLs; pending uploads never leak blob: into sync.
      uploaded.push(`![](<${url.replace(/[<>\s]/g, c => encodeURIComponent(c))}>)`)
    } catch (error) {
      if (valid()) emit('notice', `图片上传失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!valid() || !uploaded.length) return null
  if (instance.getCurrentMode() === mode) {
    if (mode === 'sv' && textarea && start !== undefined && end !== undefined) {
      textarea.focus()
      textarea.setSelectionRange(start, end)
    } else if (range?.startContainer.isConnected && root.value?.contains(range.startContainer)) {
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }
  instance.insertMD(uploaded.join('\n\n'))
  capture()
  return null
}

/** 表格入口：Vditor 内置按钮只能插固定 3×3，这里改回先问行列数。 */
function openTableDialog() {
  if (!ready || !editor || disposed || props.editable === false) return
  const selection = window.getSelection()
  tableSelection = selection?.rangeCount && root.value?.contains(selection.anchorNode)
    ? selection.getRangeAt(0).cloneRange() : undefined
  const textarea = root.value?.querySelector<HTMLTextAreaElement>('.vditor-sv')
  tableTextarea = textarea ? { start: textarea.selectionStart ?? 0, end: textarea.selectionEnd ?? 0 } : undefined
  tableOpen.value = true
}

function insertTable({ rows, cols }: { rows: number; cols: number }) {
  tableOpen.value = false
  if (!ready || !editor || disposed || props.editable === false) return
  const instance = editor
  const mode = instance.getCurrentMode()
  const generation = lifetime
  if (mode === 'sv' && tableTextarea) {
    const textarea = root.value?.querySelector<HTMLTextAreaElement>('.vditor-sv')
    textarea?.focus()
    textarea?.setSelectionRange(tableTextarea.start, tableTextarea.end)
  } else if (tableSelection?.startContainer.isConnected && root.value?.contains(tableSelection.startContainer)) {
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(tableSelection)
  }
  const previousTables = new Set(root.value?.querySelectorAll('table'))
  instance.insertMD(tableMarkdown(rows, cols))
  const firstCell = Array.from(root.value?.querySelectorAll('table') ?? []).find(table => !previousTables.has(table))?.querySelector<HTMLElement>('th')
  capture()

  // 弹窗关闭时会把焦点还给工具栏按钮；等这轮焦点恢复结束后，再把光标放回刚插入的表格。
  const selection = window.getSelection()
  const caret = mode === 'sv' ? undefined
    : selection?.rangeCount && root.value?.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange() : undefined
  const textarea = root.value?.querySelector<HTMLTextAreaElement>('.vditor-sv')
  const svCaret = textarea?.selectionStart
  setTimeout(() => {
    if (!ready || disposed || editor !== instance || generation !== lifetime || instance.getCurrentMode() !== mode || props.editable === false) return
    if (mode === 'sv') {
      const current = root.value?.querySelector<HTMLTextAreaElement>('.vditor-sv')
      current?.focus()
      if (svCaret !== undefined) current?.setSelectionRange(svCaret, svCaret)
      return
    }
    if (firstCell && !firstCell.textContent?.trim()) {
      const current = window.getSelection()
      const cellRange = document.createRange()
      cellRange.selectNodeContents(firstCell)
      cellRange.collapse(true)
      current?.removeAllRanges()
      current?.addRange(cellRange)
      firstCell.closest<HTMLElement>('[contenteditable="true"]')?.focus()
      return
    }
    if (!caret?.startContainer.isConnected || !root.value?.contains(caret.startContainer)) return
    const current = window.getSelection()
    current?.removeAllRanges()
    current?.addRange(caret)
  }, 0)
}

function openImage(image: Element) {
  if (!(image instanceof HTMLImageElement) || !root.value) return
  const container = image.closest('.vditor-reset') ?? root.value
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('img')).filter(img => !img.closest('.vditor-toolbar'))
  emit('open-lightbox', images.map(img => img.getAttribute('src') ?? img.src), images.indexOf(image))
}

let lastImageClick: { image: HTMLImageElement; time: number; x: number; y: number } | undefined
function positionImagePanel() {
  const image = lastImageClick?.image
  const panel = root.value?.querySelector<HTMLElement>('.vditor-wysiwyg > .vditor-panel')
  if (!image?.isConnected || !panel || panel.style.display !== 'block') return
  const panelRect = panel.getBoundingClientRect()
  const imageRect = image.getBoundingClientRect()
  if (panelRect.bottom <= imageRect.top || panelRect.top >= imageRect.bottom
    || panelRect.right <= imageRect.left || panelRect.left >= imageRect.right) return
  const top = imageRect.bottom + panelRect.height + 8 < window.innerHeight
    ? imageRect.bottom + 8 : imageRect.top - panelRect.height - 8
  panel.style.top = `${panel.offsetTop + top - panelRect.top}px`
}
function onDoubleClick(event: MouseEvent) {
  let image = event.target instanceof Element ? event.target.closest('img') : null
  // The native image popover can cover a small image after the first click.
  // Recognize the second click at the same point without disabling that popover.
  if (!image && lastImageClick && event.timeStamp - lastImageClick.time < 600
    && Math.abs(event.clientX - lastImageClick.x) < 4 && Math.abs(event.clientY - lastImageClick.y) < 4) image = lastImageClick.image
  if (image instanceof HTMLImageElement && root.value?.contains(image)) {
    event.preventDefault()
    event.stopPropagation()
    openImage(image)
  }
}

let longPress: ReturnType<typeof setTimeout> | undefined
function cancelLongPress() { clearTimeout(longPress) }
function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' || !(event.target instanceof HTMLImageElement)) return
  const image = event.target
  cancelLongPress()
  longPress = setTimeout(() => openImage(image), 500)
}
function onVisibility() { if (document.visibilityState === 'hidden') flush() }
function rememberMode() {
  if (ready && editor) {
    const mode = editor.getCurrentMode()
    // A newly visited mode has no undo baseline until Vditor's debounce runs.
    // Seed it before the first keystroke can replace that initial snapshot.
    if (mode !== observedMode) editor.vditor?.undo?.addToUndoStack(editor.vditor)
    if (mode !== observedMode) historyValue = editor.getValue()
    observedMode = mode
      // 自动长文模式只作用于此笔记，不覆盖普通笔记的偏好。
      if (automaticSource && mode !== 'sv') automaticSource = false
      if (!automaticSource) rememberEditorMode(mode)
      longDocumentNotice.value = automaticSource
    root.value?.setAttribute('data-mode', mode)
  }
}
/**
 * 原生表格按钮只会插入写死的 3×3。这里在捕获阶段拦下点击/触摸，改为先收行列数；
 * 禁用态（代码块或表格内）保留 Vditor 的原生判断，不弹窗。
 */
function interceptTableButton(event: Event, target: EventTarget | null): boolean {
  const button = target instanceof Element ? target.closest<HTMLElement>('.vditor-toolbar [data-type="table"]') : null
  if (!button) return false
  if (button.classList.contains('vditor-menu--disabled')) return true
  event.preventDefault()
  event.stopPropagation()
  openTableDialog()
  return true
}
function onToolbarTouch(event: Event) {
  if (interceptHistory(event)) return
  interceptTableButton(event, event.target)
}
function interceptHistory(event: Event): boolean {
  const history = event.target instanceof Element ? event.target.closest<HTMLElement>('.vditor-toolbar [data-type="undo"], .vditor-toolbar [data-type="redo"]') : null
  if (history) {
    event.preventDefault()
    event.stopPropagation()
    runHistory(history.dataset.type as 'undo' | 'redo')
    return true
  }
  return false
}
function onClick(event: MouseEvent) {
  if (interceptHistory(event)) return
  const command = event.target instanceof Element ? event.target.closest<HTMLElement>('.vditor-toolbar [data-type]') : null
  if (command && ready && editor && !command.classList.contains('vditor-menu--disabled')
    && ['headings', 'bold', 'italic', 'strike', 'highlight', 'link', 'list', 'ordered-list', 'check', 'outdent', 'indent', 'quote', 'line', 'code', 'inline-code', 'insert-before', 'insert-after', 'emoji', 'upload', 'table'].includes(command.dataset.type ?? '')
    && editor.getValue() !== historyValue) editor.vditor.undo?.addToUndoStack(editor.vditor)
  if (command?.dataset.type === 'code' && editor?.getCurrentMode() === 'wysiwyg') {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const block = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-type="code-block"]')
    const source = block?.querySelector('pre.vditor-wysiwyg__pre')
    if (block && source && root.value?.contains(block)) {
      event.preventDefault()
      event.stopPropagation()
      editor.vditor.undo?.addToUndoStack(editor.vditor)
      const range = document.createRange()
      range.selectNode(block)
      selection?.removeAllRanges()
      selection?.addRange(range)
      editor.insertMD(escapeRawHtml(source.textContent ?? ''))
      block.remove()
      capture()
      return
    }
  }
  if (interceptTableButton(event, event.target)) return
  const outlineItem = event.target instanceof Element
    ? event.target.closest<HTMLElement>('.vditor-outline [data-target-id]') : null
  if (outlineItem) {
    if (event.target instanceof Element && event.target.closest('.vditor-outline__action')) return
    // Vditor assumes the editor owns the window scroll. snotes keeps the
    // workspace shell fixed and scrolls .editor-body instead, so route the
    // native outline action to that container explicitly.
    const id = outlineItem.dataset.targetId
    const heading = id ? root.value?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null
    const host = root.value?.closest<HTMLElement>('.editor-body')
    if (heading && host) {
      event.preventDefault()
      event.stopPropagation()
      const target = root.value?.classList.contains('vditor--fullscreen')
        ? root.value.querySelector<HTMLElement>('.vditor-content') : host
      const targetRect = heading.getBoundingClientRect()
      if (target) {
        const offset = target === host ? (root.value?.querySelector('.vditor-toolbar')?.clientHeight ?? 0) + 20 : 20
        target.scrollTop += targetRect.top - target.getBoundingClientRect().top - offset
      }
      return
    }
  }
  if (event.target instanceof HTMLImageElement) {
    const image = event.target
    lastImageClick = { image, time: event.timeStamp, x: event.clientX, y: event.clientY }
    if (props.editable !== false && image.closest('.vditor-reset[contenteditable="true"]')) {
      const bounds = image.getBoundingClientRect()
      const after = event.clientX >= bounds.left + bounds.width / 2
      // Keep Vditor's image controls, but leave a text caret beside the image
      // so the next character cannot replace it or appear on the wrong side.
      queueMicrotask(() => {
        if (!image.isConnected || disposed) return
        positionImagePanel()
        const range = document.createRange()
        if (after) range.setStartAfter(image)
        else range.setStartBefore(image)
        range.collapse(true)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
    }
  }
  const anchor = event.target instanceof Element ? event.target.closest('a') : null
  if (anchor && (event.ctrlKey || event.metaKey || props.editable === false || anchor.closest('.vditor-preview'))) {
    const href = normalizeHref(anchor.getAttribute('href') ?? anchor.querySelector('.vditor-ir__marker--link')?.textContent ?? '')
    event.preventDefault()
    event.stopPropagation()
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
    return
  }
  if (props.editable === false && event.target instanceof Element && event.target.closest('input[type="checkbox"], .vditor-task')) {
    event.preventDefault()
    event.stopPropagation()
  }
  // Vditor changes currentMode in its bubbling handler after this capture
  // listener; defer one task so the host reflects the selected mode.
  setTimeout(() => {
    rememberMode()
    positionToolbarPanels()
  }, 0)
}

function positionToolbarPanels() {
  const toolbar = root.value?.querySelector<HTMLElement>('.vditor-toolbar')
  if (!toolbar) return
  toolbar.querySelectorAll<HTMLElement>('.vditor-hint, .vditor-panel').forEach(panel => {
    if (getComputedStyle(panel).display === 'none') return
    const anchor = panel.parentElement!.getBoundingClientRect()
    const bounds = toolbar.getBoundingClientRect()
    const width = panel.getBoundingClientRect().width
    const nested = !!panel.parentElement!.closest('.vditor-hint')
    panel.style.position = 'fixed'
    panel.style.top = `${nested ? anchor.top : bounds.bottom}px`
    const left = nested ? (anchor.right + width + 8 <= window.innerWidth ? anchor.right : anchor.left - width) : anchor.left
    panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`
    panel.style.right = 'auto'
    panel.style.maxHeight = `${Math.max(120, window.innerHeight - (nested ? anchor.top : bounds.bottom) - 12)}px`
    panel.style.overflowY = 'auto'
  })
}

function normalizeHref(raw: string) {
  const value = raw.trim()
  if (!value) return ''
  const compact = value.replace(/[\u0000-\u0020]/g, '')
  if (/^[a-z][a-z\d+.-]*:/i.test(compact)) return /^(https?|ftp|mailto|tel):/i.test(compact) ? value : ''
  return /^(\/|#|\.{1,2}\/)/.test(value) ? value : `https://${value}`
}

function onOutlineHover(event: MouseEvent) {
  const item = event.target instanceof Element
    ? event.target.closest<HTMLElement>('.vditor-outline [data-target-id]') : null
  if (!item) return
  // Set the browser tooltip only on demand, without scanning every heading
  // after each editor mutation. Native tooltips escape the scroll container.
  const title = item.querySelector(':scope > span')?.textContent?.trim() ?? ''
  if (item.title !== title) item.title = title
}

function onLinkChange(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.matches('.vditor-wysiwyg .vditor-panel input[placeholder="链接"]')) return
  const value = normalizeHref(input.value)
  const text = input.closest('.vditor-panel')?.querySelector<HTMLInputElement>('input')
  const fillText = text && !text.value.replace(/\u200b/g, '').trim() && value
  if (value === input.value && !fillText) return
  input.value = value
  if (fillText && text) text.value = value
  // Keep the native link popover responsible for updating the document.
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
async function initialize() {
  loadError.value = ''
  try { await loadVditorAssets() }
  catch (error) {
    if (!disposed) loadError.value = error instanceof Error ? error.message : String(error)
    return
  }
  if (disposed) return
  const initialValue = props.modelValue
  automaticSource = initialValue.length > LARGE_DOCUMENT_CHARS && editorMode() !== 'sv'
  longDocumentNotice.value = automaticSource
  editor = new Vditor(root.value!, {
    cdn: VDITOR_CDN,
    cache: { enable: false },
    mode: initialValue.length > LARGE_DOCUMENT_CHARS ? 'sv' : editorMode(),
    value: escapeRawHtml(migrateLegacyBr(props.modelValue)),
    placeholder: '首行写标题，接着记录正文…',
    lang: 'zh_CN',
    minHeight: 320,
    outline: { enable: true, position: 'right' },
    toolbarConfig: { pin: true },
    // Keep native writing tools; document management stays in the app menu.
    toolbar: [
      'headings', 'bold', 'italic', 'strike',
      { name: 'highlight', tip: '高亮', hotkey: '⌥⌘H', click: highlight, icon: '<svg viewBox="0 0 24 24"><path d="M5 3h3v7h8V3h3v18h-3v-8H8v8H5z"/></svg>' },
      'link', '|', 'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
      'quote', 'line', 'code', 'inline-code', '|',
      'upload', 'table', '|', 'undo', 'redo', '|', 'outline', 'fullscreen', 'edit-mode',
    ],
    hint: { emojiPath: `${VDITOR_CDN}/dist/images/emoji` },
    preview: {
      actions: [],
      theme: { current: 'light', path: `${VDITOR_CDN}/dist/css/content-theme` },
      markdown: { mark: true, toc: true, sanitize: true, autoSpace: false, fixTermTypo: false },
      // Preserve the app's policy against embedded active HTML.
      render: { media: { enable: false } },
    },
    upload: {
      accept: 'image/jpeg,image/png,image/gif,image/webp',
      max: MAX_BYTES,
      multiple: true,
      handler: insertImages,
    },
    image: { isPreview: true, preview: element => openImage(element) },
    link: {
      isOpen: false,
      // Vditor returns early on anchor clicks, before refreshing the popover.
      // Reuse its keyboard selection refresh to show the native link editor.
      click: element => {
        if (editor?.getCurrentMode() === 'wysiwyg') element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
      },
    },
    input: value => { capture(value); rememberMode() },
    blur: () => { flush(); rememberMode() },
    after: () => {
      if (disposed) { editor?.destroy(); return }
      ready = true
      initialized.value = true
      const instance = editor?.vditor
      if (instance?.undo) {
        const record = instance.undo.addToUndoStack.bind(instance.undo)
        instance.undo.addToUndoStack = state => {
          record(state)
          historyValue = editor!.getValue()
        }
      }
      // props may have changed while Lute and language assets were loading.
      if (props.modelValue !== initialValue) replace(props.modelValue, true)
      else {
        // The constructor already parsed the initial Markdown. Replacing it
        // here used to parse/render the entire note a second time.
        observed = editor!.getValue()
        historyValue = observed
      }
      applyTheme()
      applyEditable()
      rememberMode()
      emit('ready')
      if (!props.modelValue.trim()) void nextTick(() => { if (!disposed) focus() })
    },
  })
  observer = new MutationObserver(applyTheme)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  contentObserver = new MutationObserver(records => {
    // Ordinary text mutations need no accessibility/checkbox rescan. Coalesce
    // block changes into one scan per frame instead of one per DOM mutation.
    const added = records.some(record => Array.from(record.addedNodes).some(node => node.nodeType === Node.ELEMENT_NODE))
    const imagePanelChanged = !!lastImageClick && records.some(record => record.type === 'attributes'
      && record.target instanceof Element && record.target.matches('.vditor-wysiwyg > .vditor-panel'))
    if (!added && !imagePanelChanged) return
    controlsNeedUpdate ||= added
    if (controlsFrame !== undefined) return
    controlsFrame = requestAnimationFrame(() => {
      controlsFrame = undefined
      if (controlsNeedUpdate) updateContentControls()
      controlsNeedUpdate = false
      if (lastImageClick) positionImagePanel()
    })
  })
  contentObserver.observe(root.value!, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  window.addEventListener('pagehide', flush)
  window.addEventListener('snotes-before-update', flush)
  document.addEventListener('visibilitychange', onVisibility)
}
onMounted(() => { void initialize() })

onBeforeUnmount(() => {
  flush()
  rememberMode()
  disposed = true
  lifetime++
  clearTimer()
  cancelLongPress()
  observer?.disconnect()
  contentObserver?.disconnect()
  if (controlsFrame !== undefined) cancelAnimationFrame(controlsFrame)
  window.removeEventListener('pagehide', flush)
  window.removeEventListener('snotes-before-update', flush)
  document.removeEventListener('visibilitychange', onVisibility)
  // Vditor 4 guards its asynchronous initialization after destroy().
  if (ready) editor?.destroy()
})

defineExpose({ flush, focus, insertImages })
</script>

<template>
  <div class="editor-stage" :aria-busy="!initialized">
  <div v-if="loadError" class="editor-loading" role="alert">{{ loadError }}<button type="button" @click="initialize">重试</button></div>
  <EditorLoading v-else-if="!initialized" />
  <p v-if="initialized && longDocumentNotice" class="long-document-notice" role="status">长文已使用分屏模式快速打开，可在工具栏切换编辑模式。</p>
  <div ref="root" class="snotes-vditor" :class="{ 'is-readonly': editable === false, 'is-initializing': !initialized }" :inert="!initialized" :aria-hidden="!initialized"
    @mouseover="onOutlineHover"
    @input="onInput" @keydown.capture="onHistoryKeydown" @paste.capture="onPaste" @click.capture="onClick" @touchstart.capture="onToolbarTouch" @change.capture="onLinkChange" @keyup="rememberMode" @dblclick.capture="onDoubleClick" @pointerdown.capture="onPointerDown"
    @pointerup="cancelLongPress" @pointercancel="cancelLongPress" @pointermove="cancelLongPress" />
  <TableDialog :open="tableOpen" @submit="insertTable" @close="tableOpen = false" />
  </div>
</template>
