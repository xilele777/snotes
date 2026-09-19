<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDialogFocus } from './useDialogFocus'

const props = defineProps<{
  open: boolean
  /** 同一条笔记里的全部图片，按正文出现顺序 */
  images: string[]
  /** 打开时先看第几张 */
  initialIndex: number
}>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const frame = ref<HTMLElement | null>(null)
const index = ref(props.initialIndex)
const scale = ref(1)
const offset = ref({ x: 0, y: 0 })
const panning = ref(false)
const dragFrom = { x: 0, y: 0 }

const current = computed(() => props.images[index.value] ?? '')
const hasPrev = computed(() => index.value > 0)
const hasNext = computed(() => index.value < props.images.length - 1)
const multi = computed(() => props.images.length > 1)

useDialogFocus(() => props.open, panel, () => emit('close'))

/** 换张图或重新打开都要回到「适应屏幕」，否则上一张的缩放会带到下一张 */
function reset(keepIndex: boolean) {
  if (!keepIndex) index.value = props.initialIndex
  scale.value = 1
  offset.value = { x: 0, y: 0 }
}

watch(() => props.open, (open) => { if (open) reset(false) })

function step(delta: number) {
  const target = index.value + delta
  if (target < 0 || target >= props.images.length) return
  index.value = target
  scale.value = 1
  offset.value = { x: 0, y: 0 }
}

function zoom(factor: number) {
  const next = Math.min(Math.max(scale.value * factor, 1), 6)
  scale.value = next
  // 缩回 1 倍时把平移一并归零，否则图片会停在画面外
  if (next === 1) offset.value = { x: 0, y: 0 }
}

/** 回到「适应屏幕」：缩放与平移一起归零 */
function fit() {
  scale.value = 1
  offset.value = { x: 0, y: 0 }
}

function download() {
  const src = current.value
  if (!src) return
  const link = document.createElement('a')
  link.href = src
  // 站内图片 URL 末段就是文件名；取不到时给个兜底，免得浏览器把下载存成 "download"
  link.download = decodeURIComponent(src.split('/').pop() || '') || 'image'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** 滚轮缩放：图片放大后手指/滚轮要能推着看，所以缩放比固定步进更跟手 */
function onWheel(event: WheelEvent) {
  event.preventDefault()
  zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15)
}

function onPointerDown(event: PointerEvent) {
  // 只在放大后允许拖动：1 倍时图片已经完整可见，拖了只会把它推出画面
  if (scale.value <= 1 || event.target !== frame.value?.querySelector('img')) return
  panning.value = true
  dragFrom.x = event.clientX - offset.value.x
  dragFrom.y = event.clientY - offset.value.y
  ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!panning.value) return
  offset.value = { x: event.clientX - dragFrom.x, y: event.clientY - dragFrom.y }
}

function onPointerUp() {
  panning.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  const actions: Record<string, () => void> = {
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    ArrowUp: () => zoom(1.25),
    ArrowDown: () => zoom(1 / 1.25),
    '+': () => zoom(1.25),
    '=': () => zoom(1.25),
    '-': () => zoom(1 / 1.25),
    '0': () => fit(),
  }
  const run = actions[event.key]
  if (!run) return
  event.preventDefault()
  run()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="lightbox-mask" @click.self="emit('close')">
      <div ref="panel" class="lightbox" role="dialog" aria-modal="true" aria-label="查看图片">
        <div class="lightbox-bar">
          <button
            class="lightbox-btn"
            data-op="prev"
            :disabled="!hasPrev"
            title="上一张 (←)"
            aria-label="上一张"
            @click="step(-1)"
          >
            <AppIcon name="back" :size="20" />
          </button>
          <button class="lightbox-btn" data-op="zoom-in" title="放大 (+)" aria-label="放大" @click="zoom(1.25)">
            <AppIcon name="zoomIn" :size="20" />
          </button>
          <button class="lightbox-btn" data-op="zoom-out" title="缩小 (-)" aria-label="缩小" @click="zoom(1 / 1.25)">
            <AppIcon name="zoomOut" :size="20" />
          </button>
          <button
            class="lightbox-btn"
            data-op="fit"
            title="适应屏幕 (0)"
            aria-label="适应屏幕"
            @click="fit"
          >
            <AppIcon name="fit" :size="20" />
          </button>
          <button class="lightbox-btn" data-op="download" title="下载原图" aria-label="下载原图" @click="download">
            <AppIcon name="download" :size="20" />
          </button>

          <span v-if="multi" class="lightbox-counter" role="status">{{ index + 1 }} / {{ images.length }}</span>

          <button
            class="lightbox-btn"
            data-op="next"
            :disabled="!hasNext"
            title="下一张 (→)"
            aria-label="下一张"
            @click="step(1)"
          >
            <AppIcon name="chevron" :size="20" />
          </button>
          <button class="lightbox-btn" data-op="close" title="关闭 (Esc)" aria-label="关闭" @click="emit('close')">
            <AppIcon name="close" :size="20" />
          </button>
        </div>

        <div
          ref="frame"
          class="lightbox-stage"
          :class="{ 'is-panning': panning }"
          @wheel="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <img
            v-if="current"
            :src="current"
            alt=""
            draggable="false"
            :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }"
          >
        </div>
      </div>
    </div>
  </Teleport>
</template>
