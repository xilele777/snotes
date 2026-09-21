<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDialogFocus } from './useDialogFocus'

/** 行列上限：再大在手机上既画不下也没人手填，需要更大的表格直接贴 Markdown */
const TABLE_MIN = 1
const TABLE_MAX = 20

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ submit: [{ rows: number; cols: number }]; close: [] }>()

const rows = ref<string | number>('3')
const cols = ref<string | number>('3')
const panel = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    rows.value = '3'
    cols.value = '3'
  },
  { immediate: true },
)

useDialogFocus(() => props.open, panel, () => emit('close'))

/** 只接受范围内的整数；空串、小数、越界都视为不合法 */
function parse(raw: string | number): number | null {
  // type="number" 的 v-model 会把能转成数字的值自动转成 number，统一按字符串校验
  const value = String(raw).trim()
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return n >= TABLE_MIN && n <= TABLE_MAX ? n : null
}

const rowCount = computed(() => parse(rows.value))
const colCount = computed(() => parse(cols.value))
const canSubmit = computed(() => rowCount.value !== null && colCount.value !== null)
const hint = computed(() => (canSubmit.value ? '' : `行数与列数请填 ${TABLE_MIN} 到 ${TABLE_MAX} 之间的整数`))

function submit(event?: Event) {
  if (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229)) return
  if (rowCount.value === null || colCount.value === null) return
  emit('submit', { rows: rowCount.value, cols: colCount.value })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="emit('close')">
      <div ref="panel" class="dialog table-dialog" role="dialog" aria-modal="true" aria-label="插入表格">
        <p class="dialog-title">插入表格</p>

        <div class="table-fields">
          <label class="link-field">
            <span>行数</span>
            <input
              v-model="rows"
              class="dialog-input"
              type="number"
              inputmode="numeric"
              :min="TABLE_MIN"
              :max="TABLE_MAX"
              data-field="rows"
              aria-label="行数"
              @keydown.enter="submit"
            />
          </label>
          <label class="link-field">
            <span>列数</span>
            <input
              v-model="cols"
              class="dialog-input"
              type="number"
              inputmode="numeric"
              :min="TABLE_MIN"
              :max="TABLE_MAX"
              data-field="cols"
              aria-label="列数"
              @keydown.enter="submit"
            />
          </label>
        </div>
        <p v-if="hint" class="link-hint error" role="alert">{{ hint }}</p>

        <div class="dialog-footer">
          <button class="dialog-btn cancel" data-op="cancel" @click="emit('close')">取消</button>
          <button class="dialog-btn ok" data-op="confirm" :disabled="!canSubmit" @click="submit">插入</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
