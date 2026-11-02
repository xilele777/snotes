<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'

/**
 * 通用菜单 / 选择器浮层：Teleport 到 body 并用 fixed 定位，贴近视口边缘时向内收、底部放不下就翻到上方；
 * 方向键循环、Esc / Tab 关闭、点外部关闭、关闭后焦点回到触发按钮。
 * 默认条目带 menuitem 语义；role="group" 时保留普通按钮语义。
 * 分组菜单与笔记「更多」菜单共用：列表区的 overflow 和抽屉的 transform 都裁不到它。
 */
const props = defineProps<{
  open: boolean
  /** 打开菜单的那颗按钮，菜单贴着它定位 */
  anchor: HTMLElement | null
  label: string
  /** 附加在菜单根元素上的类名，供各处微调宽度 */
  menuClass?: string
  focusChecked?: boolean
  /** Selectors contain ordinary buttons; menus retain menuitem semantics. */
  role?: 'menu' | 'group'
  align?: 'start' | 'end'
}>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const position = ref({ top: 0, left: 0 })
// Callers may clear their selection and anchor together when closing a menu.
let trigger: HTMLElement | null = null
let returnFocus = true
let observer: ResizeObserver | undefined

/** 默认在按钮下方右对齐；贴近视口边缘时向内收，底部放不下就翻到上方。 */
function place() {
  const anchor = props.anchor
  const rect = anchor?.getBoundingClientRect()
  const menu = panel.value
  if (!rect || !menu) return
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportHeight = viewport?.height ?? window.innerHeight
  const viewportLeft = viewport?.offsetLeft ?? 0
  const viewportWidth = viewport?.width ?? window.innerWidth
  menu.style.maxHeight = `${Math.max(0, viewportHeight - 16)}px`
  menu.style.maxWidth = `${Math.max(0, viewportWidth - 16)}px`
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  const preferredLeft = props.align === 'start' ? rect.left : rect.right - width
  const left = Math.max(viewportLeft + 8, Math.min(preferredLeft, viewportLeft + viewportWidth - width - 8))
  let top = rect.bottom + 4
  if (top + height > viewportTop + viewportHeight - 8) top = rect.top - height - 4
  top = Math.max(viewportTop + 8, Math.min(top, viewportTop + viewportHeight - height - 8))
  position.value = { top, left }
}

function items(): HTMLElement[] {
  const selector = props.role === 'group' ? 'button:not(:disabled)' : '[role^="menuitem"]:not(:disabled)'
  return Array.from(panel.value?.querySelectorAll<HTMLElement>(selector) ?? [])
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  const forward = event.key === 'ArrowDown' || (props.role === 'group' && event.key === 'ArrowRight')
  const backward = event.key === 'ArrowUp' || (props.role === 'group' && event.key === 'ArrowLeft')
  if (!forward && !backward && !['Home', 'End'].includes(event.key)) return
  const list = items()
  if (list.length === 0) return
  event.preventDefault()
  const index = list.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : forward ? (index + 1) % list.length : (index - 1 + list.length) % list.length
  list[next]!.focus()
}

/** 点到菜单和触发按钮之外就关；触发按钮自己负责开关切换。 */
function onDocumentClick(event: Event) {
  const target = event.target as Node
  if (panel.value?.contains(target) || props.anchor?.contains(target)) return
  // A click in a field or another control already moved focus there.
  returnFocus = !!panel.value?.contains(document.activeElement) || document.activeElement === document.body
  emit('close')
}

function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('keydown', onKeydown as EventListener, true)
  document[method]('click', onDocumentClick, true)
  window[method]('resize', place)
  window[method]('scroll', place, true)
  window.visualViewport?.[method]('resize', place)
  window.visualViewport?.[method]('scroll', place)
}

watch(() => props.open, async (open, previous) => {
  if (open && !previous) { trigger = props.anchor; returnFocus = true; listen(true) }
  else if (!open && previous) {
    listen(false)
    observer?.disconnect()
    panel.value?.setAttribute('inert', '')
    panel.value?.removeAttribute('role')
    // 同步归还焦点：随后打开的弹窗会把它记为「打开前的焦点」，关闭后仍回到这颗按钮
    if (returnFocus) trigger?.focus({ preventScroll: true })
  }
  if (!open) return
  await nextTick()
  if (!props.open) return
  panel.value?.removeAttribute('inert')
  panel.value?.setAttribute('role', props.role ?? 'menu')
  place()
  if (typeof ResizeObserver !== 'undefined' && panel.value) {
    observer ??= new ResizeObserver(place)
    observer.observe(panel.value)
  }
  const list = items()
  const first = props.focusChecked ? list.find(item => item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-pressed') === 'true') ?? list[0] : list[0]
  first?.focus()
}, { immediate: true })

onUnmounted(() => { listen(false); observer?.disconnect() })
</script>

<template>
  <Teleport to="body">
    <Transition name="menu">
      <div
        v-if="open"
        ref="panel"
        class="action-menu"
        :class="menuClass"
        :role="role ?? 'menu'"
        :aria-label="label"
        :style="{ top: `${position.top}px`, left: `${position.left}px` }"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>
