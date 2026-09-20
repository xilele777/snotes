<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { closeOverlay } from '../navigation'
import { useUiStore, type SettingsTab } from '../stores/ui'
import { updateInfo } from '../update-check'
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'
import { useDialogFocus } from './useDialogFocus'
import AppearancePane from './settings/AppearancePane.vue'
import DataPane from './settings/DataPane.vue'
import ShortcutsPane from './settings/ShortcutsPane.vue'
import AboutPane from './settings/AboutPane.vue'

/**
 * 设置中心：与统计同款的大弹窗，左侧分页（≤720px 改为顶部横向标签条）。
 * 开合走 navigation 的 openOverlay / closeOverlay，系统返回和关闭按钮都回到原工作区。
 */
const props = defineProps<{ open: boolean }>()
const ui = useUiStore()
const panel = ref<HTMLElement | null>(null)

const tabs: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'appearance', label: '外观', icon: 'sliders' },
  { id: 'data', label: '数据', icon: 'download' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { id: 'about', label: '关于', icon: 'info' },
]
const panes = { appearance: AppearancePane, data: DataPane, shortcuts: ShortcutsPane, about: AboutPane }
const hasUpdate = computed(() => updateInfo.value?.hasUpdate === true)

const visible = (element: HTMLElement | null | undefined) =>
  !!element && element.isConnected && element.getClientRects().length > 0 && !element.closest('[inert]')

useDialogFocus(() => props.open, panel, closeOverlay, (previous) => {
  // 桌面回到触发它的图标栏按钮或版本号；手机抽屉在打开设置时已经收起，回到可见的入口。
  if (visible(previous)) return previous
  const candidates = document.querySelectorAll<HTMLElement>('[data-view="settings"].rail-button, .drawer-btn, .back-btn')
  return Array.from(candidates).find(visible) ?? null
})

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
  <Teleport to="body">
    <div v-if="open" class="dialog-mask settings-mask" @click.self="closeOverlay">
      <div ref="panel" class="dialog settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
        <div class="settings-dialog-header">
          <h2 class="dialog-title">设置</h2>
          <button type="button" class="icon-button" aria-label="关闭设置" title="关闭设置" @click="closeOverlay"><AppIcon name="close" :size="20" /></button>
        </div>
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
            <component :is="panes[ui.settingsTab]" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
