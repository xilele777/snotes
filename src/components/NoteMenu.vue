<script setup lang="ts">
import ActionMenu from './ActionMenu.vue'
import AppIcon from './AppIcon.vue'

/** 桌面和移动端统一收纳低频管理操作。 */
export type NoteMenuAction = 'color' | 'info' | 'notebooks' | 'history' | 'wordcount' | 'reading' | 'home-feed' | 'home-follow' | 'copy' | 'download' | 'import' | 'share' | 'print' | 'trash'

defineProps<{
  open: boolean
  anchor: HTMLElement | null
  canShare: boolean
  showDelete: boolean
  /** 文档信息 / 历史版本 / 字数统计是否进菜单 */
  showDocItems: boolean
  /** 「加入笔记本」是否进菜单（桌面顶栏有独立入口，窄屏顶栏排不下） */
  showNotebooks?: boolean
  /** 当前笔记已加入的笔记本数量，进菜单时给个上下文 */
  notebookCount?: number
  importing?: boolean
  /** 这条笔记此刻是否不上首页信息流 */
  homeHidden?: boolean
  /** 笔记单独设过、而所属分组又有默认值：给一个回到「跟随分组」的出口 */
  canFollowGroup?: boolean
  /** 阅读模式是否进菜单（≤720px 顶栏放不下这颗按钮，和删除同一个道理） */
  showReading?: boolean
  /** 当前是否在阅读模式里 */
  reading?: boolean
}>()

const emit = defineEmits<{ action: [NoteMenuAction]; close: [] }>()
</script>

<template>
  <ActionMenu :open="open" :anchor="anchor" label="更多操作" menu-class="note-menu" @close="emit('close')">
    <button v-if="showNotebooks" type="button" role="menuitem" class="menu-item" data-action="notebooks" @click="emit('action', 'notebooks')">
      <AppIcon name="book" :size="15" /><span>加入笔记本{{ notebookCount ? `（已加入 ${notebookCount} 本）` : '' }}</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-action="color" @click="emit('action', 'color')"><AppIcon name="highlight" :size="15" /><span>标记颜色</span></button>
    <template v-if="showDocItems">
      <button type="button" role="menuitem" class="menu-item" data-action="info" @click="emit('action', 'info')">
        <AppIcon name="info" :size="15" /><span>文档信息</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-action="history" @click="emit('action', 'history')">
        <AppIcon name="clock" :size="15" /><span>历史版本</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-action="wordcount" @click="emit('action', 'wordcount')">
        <AppIcon name="sort" :size="15" /><span>字数统计</span>
      </button>
      <button v-if="showReading" type="button" role="menuitemcheckbox" class="menu-item" data-action="reading" :aria-checked="reading === true" @click="emit('action', 'reading')">
        <AppIcon :name="reading ? 'edit' : 'book'" :size="15" /><span>{{ reading ? '退出阅读模式' : '阅读模式（正文只读）' }}</span>
      </button>
      <span class="menu-separator" aria-hidden="true"></span>
    </template>
    <!-- 首页信息流可见性：分组级设置是默认值，这里可以给单条笔记单独定 -->
    <button type="button" role="menuitemcheckbox" class="menu-item" data-action="home-feed" :aria-checked="homeHidden === true" @click="emit('action', 'home-feed')">
      <AppIcon :name="homeHidden ? 'eyeOff' : 'eye'" :size="15" />
      <span>{{ homeHidden ? '在首页信息流显示' : '不在首页信息流显示' }}</span>
    </button>
    <button v-if="canFollowGroup" type="button" role="menuitem" class="menu-item" data-action="home-follow" @click="emit('action', 'home-follow')">
      <AppIcon name="refresh" :size="15" /><span>恢复跟随分组设置</span>
    </button>
    <span class="menu-separator" aria-hidden="true"></span>
    <button type="button" role="menuitem" class="menu-item" data-action="copy" @click="emit('action', 'copy')">
      <AppIcon name="copy" :size="15" /><span>复制 Markdown</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-action="download" @click="emit('action', 'download')">
      <AppIcon name="download" :size="15" /><span>下载 .md</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-action="import" :disabled="importing" @click="emit('action', 'import')">
      <AppIcon name="upload" :size="15" /><span>{{ importing ? '正在导入…' : '导入 .md' }}</span>
    </button>
    <button v-if="canShare" type="button" role="menuitem" class="menu-item" data-action="share" @click="emit('action', 'share')">
      <AppIcon name="share" :size="15" /><span>分享到其他应用</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-action="print" @click="emit('action', 'print')">
      <AppIcon name="printer" :size="15" /><span>打印 / 存为 PDF</span>
    </button>
    <template v-if="showDelete">
      <span class="menu-separator" aria-hidden="true"></span>
      <button type="button" role="menuitem" class="menu-item danger" data-action="trash" @click="emit('action', 'trash')">
        <AppIcon name="trash" :size="15" /><span>删除</span>
      </button>
    </template>
  </ActionMenu>
</template>
