<script setup lang="ts" generic="T extends string">
const props = defineProps<{
  modelValue: T
  options: readonly { value: T; label: string }[]
  labelledby: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

function move(event: KeyboardEvent, index: number) {
  const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1
    : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
  if (!delta && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.options.length - 1
    : (index + delta + props.options.length) % props.options.length
  const option = props.options[next]
  if (!option) return
  emit('update:modelValue', option.value)
  const group = (event.currentTarget as HTMLElement).parentElement
  group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
}
</script>

<template>
  <div class="settings-seg" role="radiogroup" :aria-labelledby="labelledby">
    <button v-for="(item, index) in options" :key="item.value" type="button" role="radio"
      :aria-checked="modelValue === item.value" :tabindex="modelValue === item.value ? 0 : -1"
      :data-value="item.value" @click="emit('update:modelValue', item.value)" @keydown="move($event, index)">
      {{ item.label }}
    </button>
  </div>
</template>
