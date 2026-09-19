<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import type { Group } from '../../shared/types'
import AppIcon from './AppIcon.vue'
import { SKIN_COLORS } from './palette'

/**
 * 分组行「⋯」按钮打开的操作菜单。
 * Teleport 到 body 并用 fixed 定位：分组列表是 overflow-y:auto，窄屏抽屉还带 transform，
 * 留在侧栏里的浮层会被裁掉或相对抽屉定位。
 */
const props = defineProps<{
  /** null = 关闭 */
  group: Group | null
  /** 打开菜单的那颗按钮，菜单贴着它定位 */
  anchor: HTMLElement | null
  canMoveUp: boolean
  canMoveDown: boolean
}>()

const emit = defineEmits<{
  rename: []
  color: [string | null]
  move: [-1 | 1]
  remove: []
  close: []
}>()

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

watch(() => props.group, async (group, previous) => {
  if (group && !previous) listen(true)
  else if (!group && previous) listen(false)
  if (!group) return
  await nextTick()
  place()
  items()[0]?.focus()
})

onUnmounted(() => listen(false))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="group"
      ref="panel"
      class="group-menu"
      role="menu"
      :aria-label="`分组「${group.name}」操作`"
      :style="{ top: `${position.top}px`, left: `${position.left}px` }"
    >
      <button type="button" role="menuitem" class="menu-item" data-action="rename" @click="emit('rename')">
        <AppIcon name="edit" :size="15" /><span>重命名</span>
      </button>
      <div class="menu-colors" role="group" aria-label="标记颜色">
        <button
          v-for="color in SKIN_COLORS"
          :key="color ?? 'none'"
          type="button"
          role="menuitemradio"
          class="more-swatch"
          :class="{ 'is-none': color === null }"
          :aria-checked="group.color === color"
          :style="color ? { backgroundColor: color } : undefined"
          :title="color ? '标记颜色' : '清除颜色'"
          :aria-label="color ? `标记颜色 ${color}` : '清除颜色'"
          @click="emit('color', color)"
        />
      </div>
      <span class="menu-separator" aria-hidden="true"></span>
      <button type="button" role="menuitem" class="menu-item" data-action="up" :disabled="!canMoveUp" @click="emit('move', -1)">
        <AppIcon name="arrowUp" :size="15" /><span>上移</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-action="down" :disabled="!canMoveDown" @click="emit('move', 1)">
        <AppIcon name="arrowDown" :size="15" /><span>下移</span>
      </button>
      <span class="menu-separator" aria-hidden="true"></span>
      <button type="button" role="menuitem" class="menu-item danger" data-action="remove" @click="emit('remove')">
        <AppIcon name="trash" :size="15" /><span>删除分组</span>
      </button>
    </div>
  </Teleport>
</template>
