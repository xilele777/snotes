<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'

/**
 * 通用浮层菜单壳：Teleport 到 body 并用 fixed 定位，贴近视口边缘时向内收、底部放不下就翻到上方；
 * 方向键循环、Esc / Tab 关闭、点外部关闭、关闭后焦点回到触发按钮。
 * 条目由默认插槽提供，需带 role="menuitem" 或 role="menuitemradio"。
 * 分组菜单与笔记「更多」菜单共用：列表区的 overflow 和抽屉的 transform 都裁不到它。
 */
const props = defineProps<{
  open: boolean
  /** 打开菜单的那颗按钮，菜单贴着它定位 */
  anchor: HTMLElement | null
  label: string
  /** 附加在菜单根元素上的类名，供各处微调宽度 */
  menuClass?: string
}>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const position = ref({ top: 0, left: 0 })

/** 默认在按钮下方右对齐；贴近视口边缘时向内收，底部放不下就翻到上方。 */
function place() {
  const rect = props.anchor?.getBoundingClientRect()
  const menu = panel.value
  if (!rect || !menu) return
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
  let top = rect.bottom + 4
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4)
  position.value = { top, left }
}

function items(): HTMLElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const list = items()
  if (list.length === 0) return
  event.preventDefault()
  const index = list.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'ArrowDown' ? (index + 1) % list.length : (index - 1 + list.length) % list.length
  list[next]!.focus()
}

/** 点到菜单和触发按钮之外就关；触发按钮自己负责开关切换。 */
function onDocumentClick(event: Event) {
  const target = event.target as Node
  if (panel.value?.contains(target) || props.anchor?.contains(target)) return
  emit('close')
}

function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('keydown', onKeydown as EventListener, true)
  document[method]('click', onDocumentClick, true)
  window[method]('resize', place)
  window[method]('scroll', place, true)
}

watch(() => props.open, async (open, previous) => {
  if (open && !previous) listen(true)
  else if (!open && previous) {
    listen(false)
    // 同步归还焦点：随后打开的弹窗会把它记为「打开前的焦点」，关闭后仍回到这颗按钮
    props.anchor?.focus({ preventScroll: true })
  }
  if (!open) return
  await nextTick()
  place()
  items()[0]?.focus()
})

onUnmounted(() => listen(false))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="panel"
      class="action-menu"
      :class="menuClass"
      role="menu"
      :aria-label="label"
      :style="{ top: `${position.top}px`, left: `${position.left}px` }"
    >
      <slot />
    </div>
  </Teleport>
</template>
