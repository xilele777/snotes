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
.shortcut-section { width: 100%; max-width: 560px; min-width: 0; margin-inline: auto; }
.shortcut-section .settings-section-title { margin-bottom: 12px; }
.shortcut-list { margin: 0; }
.shortcut-list > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: baseline; gap: 20px; padding: 10px 0; border-bottom: 1px solid var(--border-light); }
.shortcut-list dt { text-align: right; min-width: 0; }
.shortcut-list dd { margin: 0; min-width: 0; text-align: left; overflow-wrap: anywhere; }
.shortcut-list code { white-space: normal; }
</style>
