import { nextTick, onUnmounted, watch, type Ref } from 'vue'

/**
 * 把键盘操作留在打开的弹窗里，关闭后把焦点还给触发它的元素。
 * `returnFocus` 收到打开前的焦点元素，可以在它已经不可见（例如抽屉收起后）时换一个可见入口。
 * 同时开着两层弹窗（设置里的退出确认）时，只有最上面那层处理 Esc 与 Tab。
 */
export function useDialogFocus(open: () => boolean, panel: Ref<HTMLElement | null>, close: () => void, returnFocus?: (previous: HTMLElement | null) => HTMLElement | null) {
  let previousFocus: HTMLElement | null = null
  let pointerStart: { target: EventTarget | null; x: number; y: number } | null = null
  let pointerCancelled = false
  const focusable = () => Array.from(panel.value?.querySelectorAll<HTMLElement>(
    'button, input, textarea, select, a[href], [tabindex]',
  ) ?? []).filter(element => {
    if (element.matches(':disabled, [tabindex="-1"], input[type="hidden"]')) return false
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (ancestor.hidden || ancestor.hasAttribute('inert') || style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  })

  /** 后打开的弹窗 Teleport 到 body 末尾，文档顺序最后的那个就是最上层 */
  function topmost(): boolean {
    const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]:not([inert])')
    return modals.length === 0 || modals[modals.length - 1] === panel.value
  }

  function onKeydown(event: KeyboardEvent) {
    if (!topmost() || event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      const items = focusable()
      const first = items[0]
      const last = items.at(-1)
      if (!first) { event.preventDefault(); return }
      if (!panel.value?.contains(document.activeElement)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target?.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  // Browsers dispatch a click on the common ancestor after dragging from a
  // field onto the backdrop. Only a gesture that starts and ends outside closes.
  function onPointerDown(event: PointerEvent) {
    pointerStart = { target: event.target, x: event.clientX, y: event.clientY }
    pointerCancelled = event.button !== 0
  }
  function onPointerCancel() { pointerCancelled = true }
  function onBackdropClick(event: MouseEvent) {
    if (topmost() && event.target === panel.value?.parentElement && (pointerCancelled || pointerStart && (
      pointerStart.target !== event.target || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6
    ))) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    pointerStart = null
    pointerCancelled = false
  }
  function listen(on: boolean) {
    const method = on ? 'addEventListener' : 'removeEventListener'
    window[method]('keydown', onKeydown as EventListener, true)
    window[method]('pointerdown', onPointerDown as EventListener, true)
    window[method]('pointercancel', onPointerCancel, true)
    window[method]('click', onBackdropClick as EventListener, true)
  }

  watch(open, async (value) => {
    if (value) {
      previousFocus = document.activeElement as HTMLElement | null
      pointerStart = null
      pointerCancelled = false
      listen(true)
      await nextTick()
      if (!open()) return
      panel.value?.removeAttribute('inert')
      panel.value?.setAttribute('aria-modal', 'true')
      const target = panel.value?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0]
      target?.focus()
      if (target instanceof HTMLInputElement) target.select()
    } else {
      listen(false)
      // Leave animations must not trap focus or keep global shortcuts blocked.
      panel.value?.setAttribute('inert', '')
      panel.value?.setAttribute('aria-modal', 'false')
      await nextTick()
      if (open() || !previousFocus) return
      const target = returnFocus?.(previousFocus) ?? previousFocus
      if (target?.isConnected) target.focus({ preventScroll: true })
      previousFocus = null
    }
  }, { immediate: true })

  onUnmounted(() => listen(false))
}
