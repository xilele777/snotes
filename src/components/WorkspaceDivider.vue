<script setup lang="ts">
import { onUnmounted, ref } from 'vue'

const props = defineProps<{
  pane: 'sidebar' | 'list'
  label: string
  size: number
  min: number
  max: number
  defaultSize: number
  controls: string
}>()
const emit = defineEmits<{ resize: [size: number] }>()
const dragging = ref(false)
let target: HTMLElement | null = null
let pointerId: number | null = null
let startX = 0
let startSize = 0
function resize(size: number) {
  emit('resize', Math.round(Math.max(props.min, Math.min(props.max, size))))
}
function start(event: PointerEvent) {
  if (event.button !== 0) return
  target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  pointerId = event.pointerId
  target.focus({ preventScroll: true })
  startX = event.clientX
  startSize = props.size
  dragging.value = true
  document.documentElement.classList.add('is-resizing-workspace')
  event.preventDefault()
}
function move(event: PointerEvent) {
  if (dragging.value && event.pointerId === pointerId) resize(startSize + event.clientX - startX)
}
function stop() {
  dragging.value = false
  document.documentElement.classList.remove('is-resizing-workspace')
  if (pointerId !== null && target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
  pointerId = null
  target = null
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') resize(props.size - (event.shiftKey ? 40 : 16))
  else if (event.key === 'ArrowRight') resize(props.size + (event.shiftKey ? 40 : 16))
  else if (event.key === 'Home') resize(props.min)
  else if (event.key === 'End') resize(props.max)
  else if (event.key === 'Enter') resize(props.defaultSize)
  else return
  event.preventDefault()
}
onUnmounted(stop)
</script>

<template>
  <div
    class="workspace-divider" :class="[`workspace-divider-${pane}`, { 'is-dragging': dragging }]"
    role="separator" tabindex="0" aria-orientation="vertical" :aria-label="label" :aria-controls="controls"
    :aria-valuenow="size" :aria-valuemin="min" :aria-valuemax="max" :aria-valuetext="`${size} 像素`"
    title="拖动调整宽度，双击恢复默认；也可用左右方向键调整"
    @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop"
    @keydown="keydown" @dblclick="resize(defaultSize)"
  />
</template>
