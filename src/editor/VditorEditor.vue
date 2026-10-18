<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import './vditor.css'
import { escapeRawHtml, migrateLegacyBr } from '../../shared/sanitize'
import { isAllowedImage, MAX_BYTES, uploadImage } from './image-upload'
import { VDITOR_CDN, editorMode, rememberEditorMode } from './vditor-options'
import { markdownFromClipboard } from './markdown-clipboard'

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
let observedMode: string | undefined
let forwardingPaste = false

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
  capture()
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
function highlight() {
  if (!editor || !ready || props.editable === false) return
  editor.insertMD(`==${editor.getSelection() || '\u200b'}==`)
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

function openImage(image: Element) {
  if (!(image instanceof HTMLImageElement) || !root.value) return
  const container = image.closest('.vditor-reset') ?? root.value
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('img')).filter(img => !img.closest('.vditor-toolbar'))
  emit('open-lightbox', images.map(img => img.getAttribute('src') ?? img.src), images.indexOf(image))
}

let lastImageClick: { image: HTMLImageElement; time: number; x: number; y: number } | undefined
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
    observedMode = mode
    rememberEditorMode(mode)
    root.value?.setAttribute('data-mode', mode)
  }
}
function onClick(event: MouseEvent) {
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
  if (event.target instanceof HTMLImageElement) lastImageClick = { image: event.target, time: event.timeStamp, x: event.clientX, y: event.clientY }
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
  toolbar.querySelectorAll<HTMLElement>(':scope > .vditor-toolbar__item > .vditor-hint, :scope > .vditor-toolbar__item > .vditor-panel').forEach(panel => {
    if (getComputedStyle(panel).display === 'none') return
    const anchor = panel.parentElement!.getBoundingClientRect()
    const bounds = toolbar.getBoundingClientRect()
    const width = panel.getBoundingClientRect().width
    panel.style.position = 'fixed'
    panel.style.top = `${bounds.bottom}px`
    panel.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`
    panel.style.right = 'auto'
    panel.style.maxHeight = `${Math.max(120, window.innerHeight - bounds.bottom - 12)}px`
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
onMounted(() => {
  editor = new Vditor(root.value!, {
    cdn: VDITOR_CDN,
    cache: { enable: false },
    mode: editorMode(),
    value: escapeRawHtml(migrateLegacyBr(props.modelValue)),
    placeholder: '首行写标题，接着记录正文…',
    lang: 'zh_CN',
    minHeight: 320,
    outline: { enable: true, position: 'right' },
    toolbarConfig: { pin: true },
    // Keep native writing tools; document management stays in the app menu.
    toolbar: [
      'emoji', 'headings', 'bold', 'italic', 'strike',
      { name: 'highlight', tip: '高亮', hotkey: '⌥⌘H', click: highlight, icon: '<svg viewBox="0 0 24 24"><path d="M5 3h3v7h8V3h3v18h-3v-8H8v8H5z"/></svg>' },
      'link', '|', 'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
      'quote', 'line', 'code', 'inline-code', 'insert-before', 'insert-after', '|',
      'upload', 'table', '|', 'undo', 'redo', '|', 'outline', 'fullscreen', 'edit-mode',
      // Keep document tools and mode/theme controls that belong in this app.
      // Vditor's product links and diagnostics are intentionally omitted.
      { name: 'more', tip: '主题与预览设置', toolbar: ['both', 'preview', 'code-theme', 'content-theme'] },
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
    input: value => { capture(value); rememberMode() },
    blur: () => { flush(); rememberMode() },
    after: () => {
      if (disposed) { editor?.destroy(); return }
      ready = true
      // props may have changed while Lute and language assets were loading.
      replace(props.modelValue, true)
      applyTheme()
      applyEditable()
      rememberMode()
      emit('ready')
      if (!props.modelValue.trim()) focus()
    },
  })
  observer = new MutationObserver(applyTheme)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  contentObserver = new MutationObserver(updateContentControls)
  contentObserver.observe(root.value!, { childList: true, subtree: true })
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  flush()
  rememberMode()
  disposed = true
  lifetime++
  clearTimer()
  cancelLongPress()
  observer?.disconnect()
  contentObserver?.disconnect()
  window.removeEventListener('pagehide', flush)
  document.removeEventListener('visibilitychange', onVisibility)
  // Vditor 4 guards its asynchronous initialization after destroy().
  if (ready) editor?.destroy()
})

defineExpose({ flush, focus, insertImages })
</script>

<template>
  <div ref="root" class="snotes-vditor" :class="{ 'is-readonly': editable === false }"
    @input="onInput" @paste.capture="onPaste" @click.capture="onClick" @change.capture="onLinkChange" @keyup="rememberMode" @dblclick.capture="onDoubleClick" @pointerdown.capture="onPointerDown"
    @pointerup="cancelLongPress" @pointercancel="cancelLongPress" @pointermove="cancelLongPress" />
</template>
