<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ActionMenu from './ActionMenu.vue'

const props = defineProps<{ label: string; modelValue: string; options: { value: string; label: string }[] }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const trigger = ref<HTMLElement | null>(null)
const open = ref(false)
const selected = computed(() => props.options.find(option => option.value === props.modelValue)?.label)
function choose(value: string) { emit('update:modelValue', value); open.value = false }
</script>

<template>
  <button ref="trigger" class="sort-trigger" :aria-label="`${label}：${selected}`" :title="label" aria-haspopup="menu" :aria-expanded="open" @click="open = !open" @keydown.down.prevent="open = true" @keydown.up.prevent="open = true">
    <AppIcon name="sort" :size="14" /><span>{{ selected }}</span><AppIcon name="chevron" :size="12" class="sort-chevron" :class="{ expanded: open }" />
  </button>
  <ActionMenu :open="open" :anchor="trigger" :label="label" menu-class="sort-menu" focus-checked @close="open = false">
    <button v-for="option in options" :key="option.value" class="menu-item" role="menuitemradio" :aria-checked="modelValue === option.value" @click="choose(option.value)">
      <span>{{ option.label }}</span><AppIcon v-if="modelValue === option.value" name="check" :size="15" class="menu-check" />
    </button>
  </ActionMenu>
</template>
