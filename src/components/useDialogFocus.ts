import { nextTick, onUnmounted, watch, type Ref } from 'vue'

/**
 * 把键盘操作留在打开的弹窗里，关闭后把焦点还给触发它的元素。
 * `returnFocus` 收到打开前的焦点元素，可以在它已经不可见（例如抽屉收起后）时换一个可见入口。
 * 同时开着两层弹窗（设置里的退出确认）时，只有最上面那层处理 Esc 与 Tab。
 */
export function useDialogFocus(open: () => boolean, panel: Ref<HTMLElement | null>, close: () => void, returnFocus?: (previous: HTMLElement | null) => HTMLElement | null) {
  let previousFocus: HTMLElement | null = null
  const focusable = () => Array.from(panel.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"]), a[href], [tabindex]:not([tabindex="-1"])',
  ) ?? [])

  /** 后打开的弹窗 Teleport 到 body 末尾，文档顺序最后的那个就是最上层 */
  function topmost(): boolean {
    const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
    return modals.length === 0 || modals[modals.length - 1] === panel.value
  }

  function onKeydown(event: KeyboardEvent) {
    if (!topmost()) return
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

  watch(open, async (value) => {
    if (value) {
      previousFocus = document.activeElement as HTMLElement | null
      window.addEventListener('keydown', onKeydown, true)
      await nextTick()
      if (!open()) return
      const target = panel.value?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0]
      target?.focus()
      if (target instanceof HTMLInputElement) target.select()
    } else {
      window.removeEventListener('keydown', onKeydown, true)
      await nextTick()
      if (open() || !previousFocus) return
      const target = returnFocus?.(previousFocus) ?? previousFocus
      if (target?.isConnected) target.focus({ preventScroll: true })
      previousFocus = null
    }
  }, { immediate: true })

  onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
}
