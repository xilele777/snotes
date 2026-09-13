<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDialogFocus } from './useDialogFocus'

const props = defineProps<{ open: boolean; title: string; initial?: string }>()
const emit = defineEmits<{ submit: [string]; close: [] }>()

const value = ref('')
const panel = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  (open) => { if (open) value.value = props.initial ?? '' },
  { immediate: true },
)
useDialogFocus(() => props.open, panel, () => emit('close'))

function submit(event?: Event) {
  if (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229)) return
  const name = value.value.trim()
  if (!name) return
  emit('submit', name)
}
</script>

<template>
  <!--
    必须 Teleport 到 body：侧栏是 overflow-y:auto，且移动端抽屉靠 transform 位移——
    transform 会给后代的 position:fixed 造出新的包含块，留在侧栏里的遮罩会被裁掉、
    并且相对侧栏而不是视口定位。
  -->
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="$emit('close')">
      <div ref="panel" class="dialog" role="dialog" aria-modal="true" :aria-label="title">
        <p class="dialog-title">{{ title }}</p>

        <input
          v-model="value"
          class="dialog-input"
          type="text"
          aria-label="分组名称"
          placeholder="分组名称"
          @keydown.enter="submit"
        />

        <div class="dialog-footer">
          <button class="dialog-btn cancel" @click="$emit('close')">取消</button>
          <button class="dialog-btn ok" :disabled="!value.trim()" @click="submit">确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
