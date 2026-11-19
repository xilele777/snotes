<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ open: boolean; dismissible?: boolean }>(), { dismissible: true })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLDialogElement | null>(null)
// Completing an action that immediately moves the editor caret must release
// native modality before emitting the result; dismissal can retain its fade.
defineExpose({ close: () => panel.value?.close() })

watch([panel, () => props.open], ([dialog]) => {
  if (props.open) dialog?.removeAttribute('data-closing')
  if (dialog && props.open && !dialog.open) dialog.showModal()
}, { flush: 'post' })

// Keep the dialog in the top layer until its fade finishes, including browsers
// without discrete display/overlay transitions. Native close restores focus.
async function leave(element: Element, done: () => void) {
  const dialog = element as HTMLDialogElement
  dialog.setAttribute('data-closing', '')
  const animations = dialog.getAnimations?.({ subtree: true }) ?? []
  if (animations.length) {
    await Promise.race([
      Promise.allSettled(animations.map(animation => animation.finished)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ])
  }
  if (!props.open && dialog.open) dialog.close()
  done()
}

function onClose(event: Event) {
  const dialog = event.target as HTMLDialogElement
  dialog.returnValue = ''
  if (props.open && !dialog.open) emit('close')
}

// A pending destructive operation must finish before its dialog is dismissed.
function onCancel(event: Event) {
  event.preventDefault()
  if (props.dismissible) emit('close')
}

// Safari without closedby still needs the existing click-outside interaction.
let pressedOutside = false
function outside(event: PointerEvent) {
  const rect = panel.value!.getBoundingClientRect()
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
}
function onPointerDown(event: PointerEvent) {
  if (!('closedBy' in HTMLDialogElement.prototype)) pressedOutside = outside(event)
}
function onPointerUp(event: PointerEvent) {
  if (!('closedBy' in HTMLDialogElement.prototype) && props.dismissible && pressedOutside && outside(event)) emit('close')
  pressedOutside = false
}
onBeforeUnmount(() => { if (panel.value?.open) panel.value.close() })
</script>

<template>
  <Transition name="dialog" @leave="leave">
    <dialog v-if="open" ref="panel" v-bind="$attrs" class="native-dialog dialog-mask" :closedby="dismissible ? 'any' : 'none'" @close="onClose" @cancel="onCancel" @pointerdown="onPointerDown" @pointerup="onPointerUp" @pointercancel="pressedOutside = false">
      <slot />
    </dialog>
  </Transition>
</template>
