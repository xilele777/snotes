import { WebSession, validLoad, BRIDGE_VERSION, type Mode } from './session'
import { renderSafePreview } from './safe-preview'
import { escapeRawHtml, migrateLegacyBr } from '../../../shared/sanitize'
import type Vditor from 'vditor'

declare global {
  interface Window { snotesNative?: { postMessage(message: string): void } }
}

const LARGE_DOCUMENT_CHARS = 50_000
const source = document.querySelector<HTMLTextAreaElement>('#source')!
const preview = document.querySelector<HTMLElement>('#preview')!
const richRoot = document.querySelector<HTMLElement>('#rich')!
const richPane = document.querySelector<HTMLElement>('#rich-pane')!
const sourcePane = document.querySelector<HTMLElement>('#source-pane')!
const notice = document.querySelector<HTMLElement>('#notice')!
const session = new WebSession(message => window.snotesNative?.postMessage(JSON.stringify(message)))

let mode: Mode = 'ir'
let rich: Vditor | undefined
let composing = false
let locked = false
let richTouched = false
let generation = 0
let modeTransition = false

function status(message: string, quiet = false) {
  notice.classList.toggle('sr-only', quiet || !message)
  notice.textContent = message
}

function readLive(): string {
  return mode === 'ir' && rich ? rich.getValue() : source.value
}

function capture(userEdit = false) {
  if (locked || modeTransition || mode === 'preview') return
  const live = readLive()
  if (mode === 'ir') source.value = live
  session.capture(live, composing, userEdit || richTouched || mode === 'source')
}

function lock(value: boolean) {
  locked = value
  source.readOnly = value || session.document?.readOnly === true
  if (value || session.document?.readOnly) rich?.disabled()
  else rich?.enable()
}

function destroyRich() {
  rich?.destroy()
  rich = undefined
  richRoot.replaceChildren()
}

function restoreAssetMarkers() {
  // Vditor.destroy removes script IDs but leaves parser/locale/sprite globals.
  // Restore those markers before remounting; otherwise Vditor uses sync XHR.
  for (const id of ['vditorLuteScript', 'vditorI18nScriptzh_CN', 'vditorIconScript']) {
    if (!document.getElementById(id)) {
      const marker = document.createElement('script')
      marker.id = id
      document.head.appendChild(marker)
    }
  }
}

function positionToolbarPanels() {
  const toolbar = richRoot.querySelector<HTMLElement>('.vditor-toolbar')
  if (!toolbar) return
  toolbar.querySelectorAll<HTMLElement>('.vditor-hint, .vditor-panel').forEach(panel => {
    if (getComputedStyle(panel).display === 'none') return
    const anchor = panel.parentElement!.getBoundingClientRect()
    const bounds = toolbar.getBoundingClientRect()
    const width = panel.getBoundingClientRect().width
    panel.style.position = 'fixed'
    panel.style.top = `${bounds.bottom + 4}px`
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
    panel.style.left = `${left}px`
    panel.style.right = 'auto'
    panel.style.maxHeight = `${Math.max(120, window.innerHeight - bounds.bottom - 16)}px`
    panel.style.overflowY = 'auto'
  })
}

function highlightSelection() {
  if (!rich || locked || composing || modeTransition || session.document?.readOnly) return
  const selected = rich.getSelection().trim() || '\u200b'
  rich.insertMD(selected.split('\n').map(line => (line.trim() ? `==${line}==` : line)).join('\n'))
  richTouched = true
  capture(true)
}

function applyRichTheme(dark: boolean) {
  if (!rich) return
  rich.setTheme(
    dark ? 'dark' : 'classic',
    dark ? 'dark' : 'light',
    dark ? 'github-dark' : 'github',
    `${location.origin}/assets/editor/vendor/vditor/dist/css/content-theme`,
  )
}

function showPane(next: Mode) {
  document.documentElement.dataset.mode = next
  richPane.hidden = next !== 'ir'
  sourcePane.hidden = next !== 'source'
  preview.hidden = next !== 'preview'
}

async function mountMode(next: Mode, initialLoad = false) {
  if (!session.document) return
  if (!initialLoad && (locked || composing || modeTransition)) return
  if (next === 'ir' && session.value.length > LARGE_DOCUMENT_CHARS) {
    next = 'source'
  }
  if (!initialLoad) capture()
  const token = ++generation
  const value = session.value
  modeTransition = true
  const canReuseRich = next === 'ir' && rich !== undefined
  if (!canReuseRich) {
    destroyRich()
  }
  mode = next
  source.value = value
  showPane(next)

  try {
    if (next === 'preview') {
      const lute = Lute.New()
      lute.SetMark(true)
      lute.SetSanitize(true)
      lute.SetAutoSpace(false)
      lute.SetFixTermTypo(false)
      const fragment = document.createElement('div')
      await renderSafePreview(fragment, lute.Md2HTML(escapeRawHtml(migrateLegacyBr(value))))
      if (token !== generation) return
      preview.replaceChildren(...fragment.childNodes)
      preview.scrollTop = 0
      status('', true)
    } else if (next === 'ir' && canReuseRich && rich) {
      const dark = session.document!.dark
      richTouched = false
      applyRichTheme(dark)
      rich.setValue(escapeRawHtml(migrateLegacyBr(value)), true)
      if (session.document?.readOnly) rich.disabled()
      else rich.enable()
      const baseline = rich.getValue()
      source.value = baseline
      session.observeBaseline(baseline)
      const contentEl = richRoot.querySelector<HTMLElement>('.vditor-content')
      if (contentEl) contentEl.scrollTop = 0
      status('', true)
    } else if (next === 'ir') {
      const { default: VditorConstructor } = await import('vditor')
      if (token !== generation) return
      restoreAssetMarkers()
      const dark = session.document!.dark
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('IR initialization timeout')), 8_000)
        try {
          richTouched = false
          rich = new VditorConstructor(richRoot, {
            value: escapeRawHtml(migrateLegacyBr(value)),
            mode: 'ir',
            lang: 'zh_CN',
            placeholder: '首行写标题，接着记录正文…',
            cdn: `${location.origin}/assets/editor/vendor/vditor`,
            cache: { enable: false },
            toolbarConfig: { pin: true, hide: session.document?.readOnly === true },
            toolbar: [
              'headings',
              'bold',
              'italic',
              'strike',
              {
                name: 'highlight',
                tip: '高亮',
                click: highlightSelection,
                icon: '<svg viewBox="0 0 24 24"><path d="M5 3h3v7h8V3h3v18h-3v-8H8v8H5z"/></svg>',
              },
              '|',
              'list',
              'ordered-list',
              'check',
              '|',
              'quote',
              'code',
              'inline-code',
              'link',
              'table',
              'line',
              '|',
              'undo',
              'redo',
              '|',
              'edit-mode',
            ],
            undoDelay: 250,
            height: '100%',
            minHeight: 240,
            theme: dark ? 'dark' : 'classic',
            hint: { emoji: {}, emojiPath: `${location.origin}/assets/editor/vendor/vditor/dist/images/emoji` },
            preview: {
              actions: [],
              theme: { current: dark ? 'dark' : 'light', path: `${location.origin}/assets/editor/vendor/vditor/dist/css/content-theme` },
              markdown: { mark: true, sanitize: true, codeBlockPreview: false, mathBlockPreview: false, autoSpace: false, fixTermTypo: false },
              render: { media: { enable: false } },
            },
            link: { isOpen: false },
            image: { isPreview: false },
            input: () => {
              if (token === generation && !composing && !modeTransition) {
                richTouched = true
                capture(true)
              }
            },
            after: () => {
              clearTimeout(timeout)
              if (token === generation && rich) {
                applyRichTheme(dark)
                session.observeBaseline(rich.getValue())
                for (const control of richRoot.querySelectorAll<HTMLElement>('[contenteditable], textarea.vditor-sv')) {
                  control.setAttribute('role', 'textbox')
                  control.setAttribute('aria-label', '笔记正文')
                  control.setAttribute('aria-multiline', 'true')
                }
                if (session.document?.readOnly) rich.disabled()
              }
              resolve()
            },
          })
        } catch (error) {
          clearTimeout(timeout)
          reject(error)
        }
      })
      if (token !== generation) return
      status('', true)
    } else {
      session.observeBaseline(value)
      status(value.length > LARGE_DOCUMENT_CHARS ? '长文已自动切换为纯文本编辑以保持流畅。' : '', value.length <= LARGE_DOCUMENT_CHARS)
    }
  } catch {
    if (token !== generation) return
    destroyRich()
    mode = 'source'
    source.value = session.value
    session.observeBaseline(session.value)
    showPane('source')
    status('即时渲染未能初始化，已切换至纯文本编辑。')
  } finally {
    if (token === generation) {
      modeTransition = false
      session.message('mode', { mode })
    }
  }
}

document.addEventListener('compositionstart', () => {
  composing = true
  richTouched = true
})
document.addEventListener('compositionend', () => {
  composing = false
  queueMicrotask(() => capture(true))
})

source.addEventListener('input', () => capture(true))
richRoot.addEventListener('input', () => {
  richTouched = true
  queueMicrotask(() => capture(true))
})
richRoot.addEventListener('click', () => {
  setTimeout(positionToolbarPanels, 0)
}, true)

document.addEventListener('keydown', event => {
  if (mode === 'source' && !event.isComposing && !composing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    const nextValue = session.history(event.shiftKey)
    if (nextValue !== undefined) source.value = nextValue
  }
})

document.addEventListener('click', event => {
  const target = event.target as Element
  const anchor = target.closest<HTMLElement>('a[href], [data-type="a"]')
  if (!anchor || anchor.closest('.vditor-toolbar')) return
  const rawHref = anchor.getAttribute('href') ?? anchor.querySelector('.vditor-ir__marker--link')?.textContent ?? ''
  if (!rawHref) return
  event.preventDefault()
  event.stopPropagation()
  try {
    const url = new URL(rawHref, location.href)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.origin !== location.origin) {
      session.message('openLink', { url: url.href })
    }
  } catch { /* Malformed and unsupported links stay inert. */ }
}, true)

document.addEventListener('visibilitychange', () => { if (document.hidden) capture() })

window.addEventListener('message', event => {
  if (event.origin && event.origin !== location.origin) return
  let message: Record<string, unknown>
  try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data } catch { return }
  if (!message || message.bridgeVersion !== BRIDGE_VERSION) return

  if (validLoad(message)) {
    generation++
    modeTransition = false
    session.load(message)
    composing = richTouched = locked = false
    source.value = message.markdown
    source.readOnly = message.readOnly
    document.documentElement.dataset.dark = String(message.dark)
    document.documentElement.style.fontSize = `${message.fontSize}px`
    if (typeof message.lineSpacing === 'string' && ['compact', 'standard', 'relaxed'].includes(message.lineSpacing)) {
      document.documentElement.dataset.lineSpacing = message.lineSpacing
    }
    const initialMode: Mode = message.readOnly
      ? 'preview'
      : message.markdown.length > LARGE_DOCUMENT_CHARS
        ? 'source'
        : 'ir'
    if (initialMode !== 'ir') destroyRich()
    void mountMode(initialMode, true).then(() => {
      if (session.document?.sessionId === message.sessionId) {
        session.message('loaded', { revision: 0 })
      }
    })
    return
  }

  const active = session.document
  if (!active || message.sessionId !== active.sessionId || message.noteId !== active.noteId || message.profileId !== active.profileId) return

  if (message.type === 'replaceMarkdown' && typeof message.markdown === 'string' && message.markdown.length <= 2_000_000 && !active.readOnly && !locked && !composing && !modeTransition) {
    const markdown = message.markdown
    if (mode === 'ir' && rich) {
      rich.setValue(escapeRawHtml(migrateLegacyBr(markdown)), true)
      richTouched = true
      capture(true)
      rich.focus()
    } else {
      source.value = markdown
      capture(true)
      source.focus()
    }
  } else if (message.type === 'appearance' && typeof message.dark === 'boolean' && typeof message.fontSize === 'number') {
    document.documentElement.dataset.dark = String(message.dark)
    document.documentElement.style.fontSize = `${Math.max(12, Math.min(48, message.fontSize))}px`
    if (typeof message.lineSpacing === 'string' && ['compact', 'standard', 'relaxed'].includes(message.lineSpacing)) {
      document.documentElement.dataset.lineSpacing = message.lineSpacing
    }
    if (session.document) session.document.dark = message.dark
    applyRichTheme(message.dark)
  } else if (message.type === 'mode' && ['source', 'preview', 'ir'].includes(String(message.mode))) {
    void mountMode(message.mode as Mode)
  } else if (message.type === 'insertImage' && typeof message.url === 'string' && /^\/api\/images\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\.(jpg|jpeg|png|gif|webp)$/.test(message.url)) {
    if (locked || composing || modeTransition || mode === 'preview' || active.readOnly) {
      status('图片已上传；当前编辑状态无法插入，请重新选择图片。')
      return
    }
    const markdown = `\n![图片](${message.url})\n`
    if (mode === 'ir' && rich) {
      rich.insertMD(markdown)
      richTouched = true
    } else {
      source.setRangeText(markdown, source.selectionStart, source.selectionEnd, 'end')
      source.focus()
    }
    capture(true)
  } else if (message.type === 'flush' && typeof message.requestId === 'string' && message.requestId.length <= 128) {
    const requestId = message.requestId
    const documentId = active.sessionId
    if (modeTransition) {
      session.message('flushError', { requestId })
      return
    }
    if (message.lock === true && composing) (document.activeElement as HTMLElement | null)?.blur()
    const doFlush = () => {
      if (documentId !== session.document?.sessionId) return
      capture()
      if (message.lock === true) lock(true)
      session.message('flushed', { requestId, revision: session.revision, markdown: session.value, composing })
    }
    if (composing) setTimeout(doFlush, 0)
    else queueMicrotask(doFlush)
  } else if (message.type === 'resume') {
    lock(false)
  } else if (message.type === 'saved' && typeof message.revision === 'number') {
    if (session.saved(active.sessionId, message.revision)) status('已保存到本机', true)
  } else if (message.type === 'saveError') {
    status('保存失败，内容仍保留在编辑器中。请重试或分享正文。')
  }
})

if (window.snotesNative) {
  window.snotesNative.postMessage(JSON.stringify({ bridgeVersion: BRIDGE_VERSION, type: 'ready', modes: ['source', 'preview', 'ir'] }))
} else {
  status('此编辑器需要 Android 本地消息桥。')
}
