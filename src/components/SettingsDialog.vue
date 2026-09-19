<script setup lang="ts">
import { ref } from 'vue'
import { useDialogFocus } from './useDialogFocus'
import { settings, updateSettings, type EditorWidth, type FontSize, type Theme } from '../settings'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
useDialogFocus(() => props.open, panel, () => emit('close'))

const themes: { value: Theme; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]
const fontSizes: { value: FontSize; label: string }[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '标准' },
  { value: 'large', label: '大' },
]
const widths: { value: EditorWidth; label: string }[] = [
  { value: 'narrow', label: '窄' },
  { value: 'medium', label: '标准' },
  { value: 'wide', label: '宽' },
]
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-mask" @click.self="$emit('close')">
      <div ref="panel" class="dialog settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
        <h3 class="dialog-title">设置</h3>

        <div class="settings-row">
          <span id="settings-theme-label" class="settings-label">主题</span>
          <div class="settings-seg" role="radiogroup" aria-labelledby="settings-theme-label" data-setting="theme">
            <button
              v-for="item in themes"
              :key="item.value"
              type="button"
              role="radio"
              :aria-checked="settings.theme === item.value"
              :data-value="item.value"
              @click="updateSettings({ theme: item.value })"
            >{{ item.label }}</button>
          </div>
        </div>

        <div class="settings-row">
          <span id="settings-font-label" class="settings-label">正文字号</span>
          <div class="settings-seg" role="radiogroup" aria-labelledby="settings-font-label" data-setting="fontSize">
            <button
              v-for="item in fontSizes"
              :key="item.value"
              type="button"
              role="radio"
              :aria-checked="settings.fontSize === item.value"
              :data-value="item.value"
              @click="updateSettings({ fontSize: item.value })"
            >{{ item.label }}</button>
          </div>
        </div>

        <div class="settings-row">
          <span id="settings-width-label" class="settings-label">编辑区宽度</span>
          <div class="settings-seg" role="radiogroup" aria-labelledby="settings-width-label" data-setting="editorWidth">
            <button
              v-for="item in widths"
              :key="item.value"
              type="button"
              role="radio"
              :aria-checked="settings.editorWidth === item.value"
              :data-value="item.value"
              @click="updateSettings({ editorWidth: item.value })"
            >{{ item.label }}</button>
          </div>
        </div>

        <p class="settings-hint">这些设置只保存在当前设备的浏览器里，不参与同步。</p>

        <div class="dialog-footer">
          <button type="button" class="dialog-btn ok" data-autofocus @click="$emit('close')">完成</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
