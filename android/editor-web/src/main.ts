import { WebSession, validLoad, BRIDGE_VERSION, type Mode } from './session'
import { renderSafePreview } from './safe-preview'
import { escapeRawHtml, migrateLegacyBr } from '../../../shared/sanitize'
import type Vditor from 'vditor'

declare global {
  interface Window { snotesNative?: { postMessage(message: string): void } }
}
const source = document.querySelector<HTMLTextAreaElement>('#source')!
const preview = document.querySelector<HTMLElement>('#preview')!
const richRoot = document.querySelector<HTMLElement>('#rich')!
const notice = document.querySelector<HTMLElement>('#notice')!
const session = new WebSession(message => window.snotesNative?.postMessage(JSON.stringify(message)))
let mode: Mode = 'source'
let rich: Vditor | undefined
let composing = false
let locked = false
let richTouched = false
let generation = 0
let modeTransition = false

function status(message: string) { notice.textContent = message }
function readLive() { return mode === 'ir' && rich ? rich.getValue() : source.value }
function capture(userEdit = false) {
  if (locked || modeTransition || mode === 'preview') return
  session.capture(readLive(), composing, userEdit || richTouched || mode === 'source')
}
function lock(value: boolean) {
  locked = value
  source.readOnly = value || session.document?.readOnly === true
  if (value || session.document?.readOnly) rich?.disabled()
  else rich?.enable()
  updateButtons()
}
function updateButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
    button.disabled = locked || modeTransition || composing || (button.dataset.mode === 'ir' && session.value.length > 50_000)
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    button.disabled = locked || composing || modeTransition || mode === 'preview' || session.document?.readOnly === true
  }
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
async function changeMode(next: Mode) {
  if (locked || composing || modeTransition || !session.document) return
  if (next === 'ir' && session.value.length > 50_000) { status('长文使用源码编辑，预览按需生成。'); return }
  capture()
  const token = ++generation
  const value = session.value
  modeTransition = true
  updateButtons()
  destroyRich()
  mode = next
  source.value = value
  document.querySelector<HTMLElement>('#source-pane')!.hidden = next !== 'source'
  document.querySelector<HTMLElement>('#rich-pane')!.hidden = next !== 'ir'
  preview.hidden = next !== 'preview'
  document.querySelector<HTMLElement>('#format')!.hidden = next === 'preview'
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
    } else if (next === 'ir') {
      const { default: VditorConstructor } = await import('vditor')
      if (token !== generation) return
      restoreAssetMarkers()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('IR initialization timeout')), 6_000)
        try {
          richTouched = false
          rich = new VditorConstructor(richRoot, {
            value: escapeRawHtml(migrateLegacyBr(value)), mode: 'ir', lang: 'zh_CN',
            cdn: `${location.origin}/assets/editor/vendor/vditor`, cache: { enable: false },
            toolbar: [], toolbarConfig: { hide: true }, undoDelay: 200,
            height: 'auto', minHeight: 240, theme: session.document!.dark ? 'dark' : 'classic',
            hint: { emoji: {}, emojiPath: `${location.origin}/assets/editor/vendor/vditor/dist/images/emoji` },
            preview: { actions: [], markdown: { mark: true, sanitize: true, codeBlockPreview: false, mathBlockPreview: false, autoSpace: false, fixTermTypo: false }, render: { media: { enable: false } } },
            link: { isOpen: false }, image: { isPreview: false },
            input: () => { if (token === generation && !composing && !modeTransition) capture() },
            after: () => {
              clearTimeout(timeout)
              if (token === generation && rich) {
                session.observeBaseline(rich.getValue())
                for (const control of richRoot.querySelectorAll<HTMLElement>('[contenteditable]')) {
                  control.setAttribute('role', 'textbox')
                  control.setAttribute('aria-label', '笔记正文')
                  control.setAttribute('aria-multiline', 'true')
                }
                if (session.document?.readOnly) rich.disabled()
              }
              resolve()
            },
          })
        } catch (error) { clearTimeout(timeout); reject(error) }
      })
    } else {
      session.observeBaseline(value)
    }
    if (token !== generation) return
    status(next === 'ir' ? '即时渲染处于试用阶段；模式转换不会自动保存。' : value.length > 50_000 ? '长文使用源码编辑，预览按需生成。' : '')
  } catch {
    if (token !== generation) return
    destroyRich()
    mode = 'source'
    source.value = session.value
    session.observeBaseline(session.value)
    document.querySelector<HTMLElement>('#source-pane')!.hidden = false
    document.querySelector<HTMLElement>('#rich-pane')!.hidden = true
    preview.hidden = true
    status('即时渲染未能初始化，已恢复源码编辑。')
  } finally {
    if (token === generation) { modeTransition = false; updateButtons(); session.message('mode', { mode }) }
  }
}

function format(action: string) {
  if (locked || composing || modeTransition || session.document?.readOnly || mode === 'preview') return
  capture()
  if (action === 'undo' || action === 'redo') {
    // Shared history also makes a document/mode switch unable to replay another note.
    const value = session.history(action === 'redo')
    if (value === undefined) return
    source.value = value
    if (rich) { rich.setValue(escapeRawHtml(migrateLegacyBr(value)), true); session.observeBaseline(rich.getValue()); richTouched = false }
    return
  }
  const [before, after] = ({ bold: ['**', '**'], mark: ['==', '=='], italic: ['*', '*'], code: ['`', '`'], quote: ['> ', ''], task: ['- [ ] ', ''], list: ['- ', ''], heading: ['# ', ''] } as Record<string, string[]>)[action] ?? ['', '']
  if (rich) {
    rich.insertMD(`${before}${rich.getSelection() || '文字'}${after}`)
    richTouched = true
    capture(true)
  } else {
    const start = source.selectionStart
    const end = source.selectionEnd
    const selection = source.value.slice(start, end) || (action === 'heading' ? '' : '文字')
    source.setRangeText(`${before}${selection}${after}`, start, end, 'select')
    capture(true)
    source.focus()
  }
}

document.querySelector('#modes')!.addEventListener('click', event => {
  const next = (event.target as Element).closest<HTMLButtonElement>('[data-mode]')?.dataset.mode as Mode | undefined
  if (next) void changeMode(next)
})
document.querySelector('#format')!.addEventListener('pointerdown', event => event.preventDefault())
document.querySelector('#format')!.addEventListener('click', event => {
  const action = (event.target as Element).closest<HTMLButtonElement>('[data-action]')?.dataset.action
  if (action) format(action)
})
document.addEventListener('compositionstart', () => { composing = true; richTouched = true; updateButtons() })
document.addEventListener('compositionend', () => {
  composing = false
  queueMicrotask(() => { capture(true); updateButtons() })
})
source.addEventListener('input', () => capture(true))
richRoot.addEventListener('input', () => {
  richTouched = true
  // Vditor updates its DOM inside the same input dispatch; read after its handler.
  queueMicrotask(() => capture(true))
})
document.addEventListener('keydown', event => {
  if (!event.isComposing && !composing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    format(event.shiftKey ? 'redo' : 'undo')
  }
})
document.addEventListener('click', event => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
  if (!link) return
  event.preventDefault()
  event.stopPropagation()
  try {
    const url = new URL(link.getAttribute('href')!, location.href)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.origin !== location.origin) session.message('openLink', { url: url.href })
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
    destroyRich()
    session.load(message)
    composing = richTouched = locked = false
    mode = 'source'
    source.value = message.markdown
    source.readOnly = message.readOnly
    document.documentElement.dataset.dark = String(message.dark)
    document.documentElement.style.fontSize = `${message.fontSize}px`
    void changeMode(message.readOnly ? 'preview' : 'source')
    session.message('loaded', { revision: 0 })
    return
  }
  const active = session.document
  if (!active || message.sessionId !== active.sessionId || message.noteId !== active.noteId || message.profileId !== active.profileId) return
  if (message.type === 'replaceMarkdown' && typeof message.markdown === 'string' && message.markdown.length <= 2_000_000 && !active.readOnly && !locked && !composing && !modeTransition) {
    const markdown = message.markdown
    void changeMode('source').then(() => { if (session.document?.sessionId !== active.sessionId || locked || composing) return; source.value = markdown; capture(true); source.focus() })
  } else if (message.type === 'appearance' && typeof message.dark === 'boolean' && typeof message.fontSize === 'number') {
    document.documentElement.dataset.dark = String(message.dark)
    document.documentElement.style.fontSize = `${Math.max(12, Math.min(48, message.fontSize))}px`
  } else if (message.type === 'mode' && ['source', 'preview'].includes(String(message.mode))) void changeMode(message.mode as Mode)
  else if (message.type === 'insertImage' && typeof message.url === 'string' && /^\/api\/images\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\.(jpg|jpeg|png|gif|webp)$/.test(message.url)) {
    if (locked || composing || modeTransition || mode === 'preview' || active.readOnly) { status('图片已上传；当前编辑状态无法插入，请重新选择图片。'); return }
    const markdown = `\n![图片](${message.url})\n`
    if (rich) { rich.insertMD(markdown); richTouched = true }
    else { source.setRangeText(markdown, source.selectionStart, source.selectionEnd, 'end'); source.focus() }
    capture(true)
  } else if (message.type === 'flush' && typeof message.requestId === 'string' && message.requestId.length <= 128) {
    const requestId = message.requestId
    const documentId = active.sessionId
    if (modeTransition) { session.message('flushError', { requestId }); return }
    // Let IME blur commit its final composition before freezing navigation.
    if (message.lock === true) (document.activeElement as HTMLElement | null)?.blur()
    setTimeout(() => {
      if (documentId !== session.document?.sessionId) return
      capture()
      if (message.lock === true) lock(true)
      session.message('flushed', { requestId, revision: session.revision, markdown: session.value, composing })
    }, 0)
  } else if (message.type === 'resume') lock(false)
  else if (message.type === 'saved' && typeof message.revision === 'number') {
    if (session.saved(active.sessionId, message.revision)) status('已保存到本机')
  } else if (message.type === 'saveError') status('保存失败，内容仍保留在编辑器中。请重试或分享正文。')
})
updateButtons()
if (window.snotesNative) window.snotesNative.postMessage(JSON.stringify({ bridgeVersion: BRIDGE_VERSION, type: 'ready', modes: ['source', 'preview', 'ir'] }))
else status('此编辑器需要 Android 本地消息桥。')
