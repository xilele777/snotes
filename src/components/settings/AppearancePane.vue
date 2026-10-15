<script setup lang="ts">
import { settings, updateSettings, type EditorWidth, type FontSize, type TableDensity, type Theme, type NoteDensity, type LineSpacing } from '../../settings'
import SettingsHint from './SettingsHint.vue'

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
const noteDensities: { value: NoteDensity; label: string }[] = [
  { value: 'comfortable', label: '舒适' }, { value: 'compact', label: '紧凑' },
]
const lineSpacings: { value: LineSpacing; label: string }[] = [
  { value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'relaxed', label: '宽松' },
]
</script>

<template>
  <section class="settings-section">
    <h2>界面与列表<SettingsHint id="settings-interface-hint" label="界面与列表" text="主题、列表密度和摘要显示仅保存在当前设备，调整后立即生效。" /></h2>
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
      <span id="settings-note-density-label" class="settings-label">笔记列表密度</span>
      <div class="settings-seg" role="radiogroup" aria-labelledby="settings-note-density-label" data-setting="noteDensity">
        <button v-for="item in noteDensities" :key="item.value" type="button" role="radio" :aria-checked="settings.noteDensity === item.value" :data-value="item.value" @click="updateSettings({ noteDensity: item.value })">{{ item.label }}</button>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-preview-heading"><span id="settings-preview-label" class="settings-label">显示笔记摘要</span><SettingsHint id="settings-preview-hint" label="显示笔记摘要" text="在列表标题下展示正文预览。" /></div>
      <button class="settings-switch" type="button" role="switch" aria-labelledby="settings-preview-label" :aria-checked="settings.showNotePreview" @click="updateSettings({ showNotePreview: !settings.showNotePreview })"><span></span></button>
    </div>
  </section>
  <section class="settings-section">
    <h2>编辑与阅读<SettingsHint id="settings-reading-hint" label="编辑与阅读" text="阅读偏好仅保存在当前设备，调整后立即生效，不会修改笔记内容。" /></h2>
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
      <span id="settings-line-spacing-label" class="settings-label">正文行距</span>
      <div class="settings-seg" role="radiogroup" aria-labelledby="settings-line-spacing-label" data-setting="lineSpacing">
        <button v-for="item in lineSpacings" :key="item.value" type="button" role="radio" :aria-checked="settings.lineSpacing === item.value" :data-value="item.value" @click="updateSettings({ lineSpacing: item.value })">{{ item.label }}</button>
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
  </section>
</template>

<style scoped>
.settings-preview-heading { position: relative; display: flex; align-items: center; flex: 1; min-width: 0; }
</style>
