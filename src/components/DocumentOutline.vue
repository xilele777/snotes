<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ root: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
const headings = shallowRef<{ element: HTMLElement; text: string; level: number }[]>([])
const active = ref(0)
let observer: MutationObserver | undefined
let observedRoot: HTMLElement | null = null
let frame = 0
function updateActive() {
  if (!props.root) return
  const top = props.root.getBoundingClientRect().top + 64
  const index = headings.value.findLastIndex(heading => heading.element.getBoundingClientRect().top <= top)
  active.value = Math.max(0, index)
}
function scan() {
  headings.value = Array.from(props.root?.querySelectorAll<HTMLElement>('.ProseMirror :is(h1,h2,h3,h4)') ?? [])
    .filter(element => element.textContent?.trim())
    .map(element => ({ element, text: element.textContent!.trim(), level: Number(element.tagName.slice(1)) }))
  updateActive()
}
function scheduleScan() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(scan)
}
function detach() {
  observer?.disconnect()
  observedRoot?.removeEventListener('scroll', updateActive)
  cancelAnimationFrame(frame)
}
watch(() => props.root, root => {
  detach()
  observedRoot = root
  scan()
  if (!root) return
  observer = new MutationObserver(scheduleScan)
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  root.addEventListener('scroll', updateActive, { passive: true })
}, { immediate: true, flush: 'post' })
function jump(element: HTMLElement) {
  if (!props.root) return
  props.root.scrollTo({ top: props.root.scrollTop + element.getBoundingClientRect().top - props.root.getBoundingClientRect().top - 32, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
onMounted(() => panel.value?.querySelector<HTMLButtonElement>('.outline-close')?.focus({ preventScroll: true }))
onUnmounted(detach)
</script>

<template>
  <aside id="document-outline" ref="panel" class="document-outline" aria-label="笔记大纲" @keydown.esc.stop.prevent="emit('close')">
    <header><span><AppIcon name="outline" :size="16" />大纲</span><button class="icon-button outline-close" type="button" aria-label="关闭大纲" @click="emit('close')"><AppIcon name="close" :size="16" /></button></header>
    <nav v-if="headings.length" aria-label="正文标题"><button v-for="(heading, index) in headings" :key="index" type="button" :class="{ active: active === index }" :style="{ paddingLeft: `${12 + Math.max(0, heading.level - 1) * 12}px` }" :aria-current="active === index ? 'location' : undefined" :title="heading.text" @click="jump(heading.element)">{{ heading.text }}</button></nav>
    <div v-else class="outline-empty"><AppIcon name="outline" :size="28" /><p>从一个标题开始</p><small>正文中的标题会出现在这里，点击即可跳转。</small></div>
  </aside>
</template>

<style scoped>
.document-outline { width: 208px; min-width: 0; flex: none; overflow-y: auto; border-left: 1px solid var(--border-light); background: var(--bg-surface); padding: 12px; }
header, header > span { display: flex; align-items: center; gap: 8px; }
header { justify-content: space-between; margin-bottom: 16px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
nav { display: grid; gap: 4px; }
nav button { display: block; width: 100%; min-width: 0; padding: 8px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
nav button:hover { background: var(--bg-hover); }
nav button.active { color: var(--selected-text); background: var(--accent-soft); }
.outline-empty { padding: 28px 8px; color: var(--text-tertiary); text-align: center; }
.outline-empty p { margin: 12px 0 6px; font-size: 13px; }
.outline-empty small { font-size: 12px; line-height: 1.8; }
@container (max-width: 760px) { .document-outline { position: absolute; top: 12px; right: 12px; bottom: 12px; z-index: 28; width: min(240px, calc(100% - 24px)); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-floating); } }
@media print { .document-outline { display: none; } }
</style>
