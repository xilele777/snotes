<script setup lang="ts">
import type { Group } from '../../shared/types'
import ActionMenu from './ActionMenu.vue'
import AppIcon from './AppIcon.vue'
import { SKIN_COLORS } from './palette'

/** 分组行「⋯」按钮打开的操作菜单：定位、键盘与关闭行为都在 ActionMenu 里。 */
const props = defineProps<{
  /** null = 关闭 */
  group: Group | null
  /** 打开菜单的那颗按钮，菜单贴着它定位 */
  anchor: HTMLElement | null
  canMoveUp: boolean
  canMoveDown: boolean
}>()

const emit = defineEmits<{
  rename: []
  color: [string | null]
  /** 组内笔记是否默认不上首页信息流 */
  homeFeed: [boolean]
  move: [-1 | 1]
  remove: []
  close: []
}>()
</script>

<template>
  <ActionMenu :open="props.group !== null" :anchor="anchor" :label="`分组「${group?.name ?? ''}」操作`" menu-class="group-menu" @close="emit('close')">
    <template v-if="group">
      <button type="button" role="menuitem" class="menu-item" data-action="rename" @click="emit('rename')">
        <AppIcon name="edit" :size="15" /><span>重命名</span>
      </button>
      <div class="menu-colors" role="group" aria-label="标记颜色">
        <button
          v-for="color in SKIN_COLORS"
          :key="color ?? 'none'"
          type="button"
          role="menuitemradio"
          class="more-swatch"
          :class="{ 'is-none': color === null }"
          :aria-checked="group.color === color"
          :style="color ? { backgroundColor: color } : undefined"
          :title="color ? '标记颜色' : '清除颜色'"
          :aria-label="color ? `标记颜色 ${color}` : '清除颜色'"
          @click="emit('color', color)"
        />
      </div>
      <span class="menu-separator" aria-hidden="true"></span>
      <!-- 分组级默认：组内没有单独设置过的笔记跟着它走 -->
      <button
        type="button"
        role="menuitemcheckbox"
        class="menu-item"
        data-action="home-feed"
        :aria-checked="group.hide_from_home === 1"
        @click="emit('homeFeed', group.hide_from_home !== 1)"
      >
        <AppIcon :name="group.hide_from_home === 1 ? 'eyeOff' : 'eye'" :size="15" />
        <span>不上首页信息流</span>
        <AppIcon v-if="group.hide_from_home === 1" name="check" :size="15" class="menu-check" />
      </button>
      <span class="menu-separator" aria-hidden="true"></span>
      <button type="button" role="menuitem" class="menu-item" data-action="up" :disabled="!canMoveUp" @click="emit('move', -1)">
        <AppIcon name="arrowUp" :size="15" /><span>上移</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-action="down" :disabled="!canMoveDown" @click="emit('move', 1)">
        <AppIcon name="arrowDown" :size="15" /><span>下移</span>
      </button>
      <span class="menu-separator" aria-hidden="true"></span>
      <button type="button" role="menuitem" class="menu-item danger" data-action="remove" @click="emit('remove')">
        <AppIcon name="trash" :size="15" /><span>删除分组</span>
      </button>
    </template>
  </ActionMenu>
</template>
