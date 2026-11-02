<script setup lang="ts">
import { settings, updateSettings, type EditorWidth, type FontSize, type TableDensity, type Theme, type NoteDensity, type LineSpacing } from '../../settings'
import SettingsHint from './SettingsHint.vue'
import SegmentedControl from '../SegmentedControl.vue'

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
      <SegmentedControl data-setting="theme" labelledby="settings-theme-label" :model-value="settings.theme" :options="themes" @update:model-value="updateSettings({ theme: $event })" />
    </div>

    <div class="settings-row">
      <span id="settings-note-density-label" class="settings-label">笔记列表密度</span>
      <SegmentedControl data-setting="noteDensity" labelledby="settings-note-density-label" :model-value="settings.noteDensity" :options="noteDensities" @update:model-value="updateSettings({ noteDensity: $event })" />
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
      <SegmentedControl data-setting="fontSize" labelledby="settings-font-label" :model-value="settings.fontSize" :options="fontSizes" @update:model-value="updateSettings({ fontSize: $event })" />
    </div>

    <div class="settings-row">
      <span id="settings-width-label" class="settings-label">编辑区宽度</span>
      <SegmentedControl data-setting="editorWidth" labelledby="settings-width-label" :model-value="settings.editorWidth" :options="widths" @update:model-value="updateSettings({ editorWidth: $event })" />
    </div>

    <div class="settings-row">
      <span id="settings-line-spacing-label" class="settings-label">正文行距</span>
      <SegmentedControl data-setting="lineSpacing" labelledby="settings-line-spacing-label" :model-value="settings.lineSpacing" :options="lineSpacings" @update:model-value="updateSettings({ lineSpacing: $event })" />
    </div>
    <div class="settings-row">
      <span id="settings-density-label" class="settings-label">表格密度</span>
      <SegmentedControl data-setting="tableDensity" labelledby="settings-density-label" :model-value="settings.tableDensity" :options="densities" @update:model-value="updateSettings({ tableDensity: $event })" />
    </div>
  </section>
</template>

<style scoped>
.settings-preview-heading { position: relative; display: flex; align-items: center; flex: 1; min-width: 0; }
</style>
