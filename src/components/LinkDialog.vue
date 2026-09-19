<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { normalizeHref } from '../editor/link'
import { useDialogFocus } from './useDialogFocus'

/** 插入链接（工具栏）与改写链接（气泡）共用这一个弹窗 */
const props = withDefaults(
  defineProps<{
    open: boolean
    /** 打开时预填的地址 */
    href?: string
    /** 打开时预填的链接文字 */
    text?: string
    /** 已经在链接上：标题与按钮文案换成「保存」而不是「插入」 */
    editing?: boolean
  }>(),
  { href: '', text: '', editing: false },
)

const emit = defineEmits<{ submit: [{ href: string; text: string }]; close: [] }>()

const href = ref('')
const text = ref('')
const panel = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    href.value = props.href
    text.value = props.text
  },
  { immediate: true },
)

useDialogFocus(() => props.open, panel, () => emit('close'))

/** 空串合法（表示还没填），填了但不合法才拦 */
const hrefError = computed(() => href.value.trim() !== '' && normalizeHref(href.value) === null)
const canSubmit = computed(() => normalizeHref(href.value) !== null)

function submit(event?: Event) {
  if (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229)) return
  if (!canSubmit.value) return
  emit('submit', { href: href.value, text: text.value })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="emit('close')">
      <div ref="panel" class="dialog link-dialog" role="dialog" aria-modal="true" :aria-label="editing ? '编辑链接' : '插入链接'">
        <p class="dialog-title">{{ editing ? '编辑链接' : '插入链接' }}</p>

        <label class="link-field">
          <span>地址</span>
          <input
            v-model="href"
            class="dialog-input"
            type="text"
            inputmode="url"
            data-field="href"
            aria-label="链接地址"
            placeholder="example.com 或 /某条路径"
            @keydown.enter="submit"
          />
        </label>
        <p v-if="hrefError" class="link-hint error" role="alert">这个地址不能用，请换个 http(s) 或站内地址</p>

        <label class="link-field">
          <span>文字</span>
          <input
            v-model="text"
            class="dialog-input"
            type="text"
            data-field="text"
            aria-label="链接文字"
            placeholder="留空则用地址本身"
            @keydown.enter="submit"
          />
        </label>

        <div class="dialog-footer">
          <button class="dialog-btn cancel" data-op="cancel" @click="emit('close')">取消</button>
          <button class="dialog-btn ok" data-op="confirm" :disabled="!canSubmit" @click="submit">确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
