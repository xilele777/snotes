<script setup lang="ts">
import { settings, updateSettings, type EditorWidth, type FontSize, type TableDensity, type Theme } from '../../settings'

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
const densities: { value: TableDensity; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'medium', label: '标准' },
  { value: 'loose', label: '宽松' },
]
</script>

<template>
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

  <div class="settings-row">
    <span id="settings-density-label" class="settings-label">表格密度</span>
    <div class="settings-seg" role="radiogroup" aria-labelledby="settings-density-label" data-setting="tableDensity">
      <button
        v-for="item in densities"
        :key="item.value"
        type="button"
        role="radio"
        :aria-checked="settings.tableDensity === item.value"
        :data-value="item.value"
        @click="updateSettings({ tableDensity: item.value })"
      >{{ item.label }}</button>
    </div>
  </div>
</template>
