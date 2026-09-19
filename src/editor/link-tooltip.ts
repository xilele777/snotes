import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { copyText } from '../export/share'
import { linkRangeAt, openHref, type LinkRange } from './link'

export interface LinkTooltipOptions {
  /** 点「编辑」：交给宿主弹出地址输入框 */
  edit: (href: string) => void
  /** 复制结果反馈，交给宿主的提示条 */
  notify: (message: string) => void
}

const key = new PluginKey('link-tooltip')

const ACTIONS: [action: string, label: string][] = [
  ['open', '打开'],
  ['edit', '编辑'],
  ['copy', '复制'],
  ['remove', '移除'],
]

/**
 * 光标落在链接上时在链接上方浮出一个小气泡：打开、编辑地址、复制、移除。
 *
 * 气泡挂在 body 上并用 fixed 定位（跟着 coordsAtPos 走），不放进编辑器 DOM：
 * 放进去的话点击会被 ProseMirror 当成编辑器内的事件处理，选区一动气泡就没了。
 * 气泡自身的 mousedown 也要拦掉，否则按一下按钮编辑器失焦、选区消失、气泡自己关掉。
 */
function createTooltip(view: EditorView, options: LinkTooltipOptions) {
  const dom = document.createElement('div')
  dom.className = 'link-tooltip'
  dom.setAttribute('role', 'toolbar')
  dom.setAttribute('aria-label', '链接操作')
  dom.hidden = true

  for (const [action, label] of ACTIONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'link-tooltip-btn'
    if (action === 'remove') button.classList.add('danger')
    button.dataset.linkAction = action
    button.textContent = label
    dom.append(button)
  }

  let href = ''
  let destroyed = false

  const hide = () => {
    dom.hidden = true
    href = ''
  }

  /** 贴在链接上方居中；贴边或放不下时向内收 */
  function place(range: LinkRange) {
    const start = view.coordsAtPos(range.from)
    const end = view.coordsAtPos(range.to)
    if (start.bottom < 0 || start.top > window.innerHeight) {
      hide()
      return
    }
    dom.style.visibility = 'hidden'
    dom.hidden = false
    const width = dom.offsetWidth
    const height = dom.offsetHeight
    const center = (start.left + end.right) / 2
    dom.style.left = `${Math.round(Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8)))}px`
    dom.style.top = `${Math.round(Math.max(8, start.top - height - 8))}px`
    dom.style.visibility = 'visible'
  }

  function show(range: LinkRange) {
    href = range.href
    place(range)
  }

  function reposition() {
    if (destroyed || dom.hidden) return
    const range = linkRangeAt(view.state)
    if (!range) {
      hide()
      return
    }
    show(range)
  }

  function removeLink(target: EditorView) {
    const range = linkRangeAt(target.state)
    const type = target.state.schema.marks.link
    if (!range || !type) return
    target.dispatch(target.state.tr.removeMark(range.from, range.to, type))
    target.focus()
    hide()
  }

  dom.addEventListener('mousedown', (event) => event.preventDefault())
  dom.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-link-action]')?.dataset.linkAction
    if (!action) return
    event.preventDefault()
    if (action === 'open') {
      openHref(href)
      hide()
    } else if (action === 'edit') {
      options.edit(href)
    } else if (action === 'copy') {
      void copyText(href).then((ok) => options.notify(ok ? '已复制链接' : '复制失败'))
    } else if (action === 'remove') {
      removeLink(view)
    }
  })

  // 编辑器滚动或窗口尺寸变化时坐标会变，重新贴一次
  const onScroll = () => reposition()
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
  view.dom.addEventListener('blur', hide)

  document.body.appendChild(dom)

  return {
    update: (current: EditorView) => {
      if (!current.editable) {
        hide()
        return
      }
      const range = linkRangeAt(current.state)
      if (!range) hide()
      else if (range.href !== href || dom.hidden) show(range)
      else place(range)
    },
    destroy: () => {
      destroyed = true
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      view.dom.removeEventListener('blur', hide)
      dom.remove()
    },
  }
}

/**
 * 编辑态按住 Ctrl / Cmd 点链接直接打开。普通点击仍然只是把光标放到链接里，
 * 好让气泡出现——正文里到处都是链接时，误触跳转比多想一步更烦人。
 */
function handleClick(view: EditorView, event: MouseEvent) {
  const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  const href = anchor?.getAttribute('href') ?? ''
  if (!href || !view.editable) return false
  if (!event.metaKey && !event.ctrlKey) return false
  event.preventDefault()
  openHref(href)
  return true
}

export function linkTooltip(options: LinkTooltipOptions) {
  return $prose(() => new Plugin({
    key,
    view: (editorView) => createTooltip(editorView, options),
    props: {
      handleDOMEvents: {
        click: handleClick,
      },
    },
  }))
}
