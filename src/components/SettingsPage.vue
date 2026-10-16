<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { closeWorkspacePage, openDrawer } from '../navigation'
import { useUiStore, type SettingsTab } from '../stores/ui'
import { updateInfo } from '../update-check'
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'
import AppearancePane from './settings/AppearancePane.vue'
import DataPane from './settings/DataPane.vue'
import ShortcutsPane from './settings/ShortcutsPane.vue'
import AboutPane from './settings/AboutPane.vue'
import AgentsPane from './settings/AgentsPane.vue'

defineProps<{ open: boolean }>()
const ui = useUiStore()
const heading = ref<HTMLElement | null>(null)
onMounted(() => heading.value?.focus({ preventScroll: true }))

const tabs: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'appearance', label: '外观', icon: 'sliders' },
  { id: 'data', label: '数据', icon: 'download' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { id: 'agents', label: 'Agent 接入', icon: 'share' },
  { id: 'about', label: '关于', icon: 'info' },
]
const panes = { appearance: AppearancePane, data: DataPane, shortcuts: ShortcutsPane, agents: AgentsPane, about: AboutPane }
const hasUpdate = computed(() => updateInfo.value?.hasUpdate === true)

async function selectTab(tab: SettingsTab, focus = false) {
  ui.settingsTab = tab
  if (!focus) return
  await nextTick()
  document.getElementById(`settings-tab-${tab}`)?.focus()
}

/** 分页列表内 ← → ↑ ↓ 循环切换，Home / End 跳到两端 */
function onTabKeydown(event: KeyboardEvent) {
  const index = tabs.findIndex(tab => tab.id === ui.settingsTab)
  let next = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else return
  event.preventDefault()
  void selectTab(tabs[next]!.id, true)
}
</script>

<template>
  <section v-if="open" class="workspace-page settings-page" role="region" aria-label="设置">
    <header class="workspace-page-header">
      <button class="drawer-btn" aria-label="打开侧栏" @click="openDrawer"><AppIcon name="menu" /></button>
      <h1 ref="heading" tabindex="-1">设置</h1>
      <button class="page-back" aria-label="返回工作区" @click="closeWorkspacePage"><AppIcon name="back" :size="17" /><span>返回工作区</span></button>
    </header>
    <div class="settings-body">
      <div class="settings-tabs" role="tablist" aria-label="设置分页" @keydown="onTabKeydown">
        <button
          v-for="tab in tabs"
          :id="`settings-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          class="settings-tab"
          :class="{ 'has-update': tab.id === 'about' && hasUpdate }"
          :data-tab="tab.id"
          :aria-selected="ui.settingsTab === tab.id"
          :aria-controls="`settings-pane-${tab.id}`"
          :tabindex="ui.settingsTab === tab.id ? 0 : -1"
          :data-autofocus="ui.settingsTab === tab.id ? '' : undefined"
          @click="selectTab(tab.id)"
        >
          <AppIcon :name="tab.icon" :size="16" /><span>{{ tab.label }}</span>
        </button>
      </div>
      <div :id="`settings-pane-${ui.settingsTab}`" class="settings-pane" role="tabpanel" :aria-labelledby="`settings-tab-${ui.settingsTab}`">
        <div class="settings-content"><component :is="panes[ui.settingsTab]" /></div>
      </div>
    </div>
  </section>
</template>
