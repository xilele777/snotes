<script setup lang="ts">
import { EDITOR_SHORTCUT_LIST, MARKDOWN_HINTS, SHORTCUT_LIST } from '../shortcut'

/** Mod 按平台显示为 ⌘ 或 Ctrl */
const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
const withMod = (list: { keys: string; label: string }[]) => list.map(item => ({ ...item, keys: item.keys.replace(/Mod/g, modKey) }))
const globalList = withMod(SHORTCUT_LIST)
const editorList = withMod(EDITOR_SHORTCUT_LIST)
</script>

<template>
  <section class="shortcut-section" aria-labelledby="shortcut-global">
    <h4 id="shortcut-global" class="settings-section-title">全局</h4>
    <dl class="shortcut-list"><div v-for="item in globalList" :key="item.keys"><dt><code>{{ item.keys }}</code></dt><dd>{{ item.label }}</dd></div></dl>
  </section>

  <section class="shortcut-section" aria-labelledby="shortcut-editor">
    <h4 id="shortcut-editor" class="settings-section-title">编辑器内</h4>
    <dl class="shortcut-list"><div v-for="item in editorList" :key="item.keys"><dt><code>{{ item.keys }}</code></dt><dd>{{ item.label }}</dd></div></dl>
  </section>

  <section class="shortcut-section" aria-labelledby="shortcut-markdown">
    <h4 id="shortcut-markdown" class="settings-section-title">Markdown 速查</h4>
    <dl class="shortcut-list"><div v-for="item in MARKDOWN_HINTS" :key="item.keys"><dt><code>{{ item.keys }}</code></dt><dd>{{ item.label }}</dd></div></dl>
  </section>
</template>

<style scoped>
/*
 * min-width: 0 是关键：外层 .settings-pane 是 flex 容器，flex 子项默认 min-width: auto
 * 会被撑满整行，于是下面清单的 max-width: 100% 会解析成「整行宽」，
 * margin-inline: auto 就没有余量可分，整块只能贴左边。断掉这条链才能真的居中。
 */
.shortcut-section { max-width: 560px; min-width: 0; margin-inline: auto; }
.shortcut-section .settings-section-title { text-align: center; margin-bottom: 14px; }
/*
 * 快捷键清单按「表格」来排：
 * - 两列等宽（各 1fr），整张表定宽 + margin-inline: auto 居中，两端留白一样；
 * - 每列内容在自己那一列里居中（dt / dd 都是 text-align: center）；
 * - 列距收窄到 12px：两列各自往中间靠，说明紧跟键位。
 * 定宽而不是 width: max-content：表格宽度不随最长键位跳来跳去，视觉更稳定。
 */
.shortcut-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 12px; row-gap: 6px; width: min(340px, 100%); margin-inline: auto; }
.shortcut-list > div { display: contents; }
.shortcut-list dt { text-align: center; white-space: nowrap; }
.shortcut-list dd { min-width: 0; text-align: center; overflow-wrap: anywhere; }
.shortcut-list code { white-space: normal; }
@media (max-width: 480px) {
  .shortcut-list { column-gap: 12px; row-gap: 4px; width: 100%; }
}
</style>
