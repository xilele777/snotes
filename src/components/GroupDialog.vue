<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ open: boolean; title: string; initial?: string }>()
const emit = defineEmits<{ submit: [string]; close: [] }>()

const value = ref('')
const input = ref<HTMLInputElement | null>(null)

/**
 * Esc 关闭。挂在 window 的捕获阶段并 stopPropagation：
 * App 也在 window 上听 keydown（Esc 用来清搜索词），不拦住的话一次 Esc 会同时
 * 关弹窗和清掉搜索框，用户只按了一下却发生两件事。
 */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  e.preventDefault()
  emit('close')
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      value.value = props.initial ?? ''
      window.addEventListener('keydown', onKeydown, true)
      await nextTick()
      input.value?.focus()
      input.value?.select()
    } else {
      window.removeEventListener('keydown', onKeydown, true)
    }
  }
)

onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

function submit() {
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
      <div class="dialog" role="dialog" aria-modal="true" :aria-label="title">
        <p class="dialog-title">{{ title }}</p>

        <input
          ref="input"
          v-model="value"
          class="dialog-input"
          type="text"
          placeholder="分组名称"
          @keyup.enter="submit"
        />

        <div class="dialog-footer">
          <button class="dialog-btn cancel" @click="$emit('close')">取消</button>
          <button class="dialog-btn ok" :disabled="!value.trim()" @click="submit">确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
