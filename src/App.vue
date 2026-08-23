<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { hasToken } from './api/token'
import GroupSidebar from './components/GroupSidebar.vue'
import MilkdownEditor from './editor/MilkdownEditor.vue'
import NoteList from './components/NoteList.vue'
import TokenGate from './components/TokenGate.vue'
import TrashView from './components/TrashView.vue'
import { resolveShortcut } from './components/shortcut'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import { useGroupsStore } from './stores/groups'

const notes = useNotesStore()
const ui = useUiStore()
const groups = useGroupsStore()

/** 6 色皮肤板（与 NoteList 一致，UI 规格 §3.5）。null 为清除。 */
const SKIN_COLORS = [null, '#fed634', '#ffac00', '#e97663', '#5e7a88', '#3692f5'] as const

// 编辑器顶栏「更多」菜单展开态
const moreOpen = ref(false)

// 移动端 <720px 列表↔编辑器互斥（UI 规格 §2.3）
const mobilePane = ref<'list' | 'editor'>('list')

// 选中笔记即切到编辑器；当前笔记被清空（如删除）则回到列表
watch(
  () => notes.currentId,
  (id) => {
    if (id) mobilePane.value = 'editor'
  },
)
function backToList() {
  mobilePane.value = 'list'
}

// 全局快捷键（UI 规格 §6.2）
function onKeydown(e: KeyboardEvent) {
  const action = resolveShortcut(e, { hasQuery: ui.query.trim().length > 0 })
  if (!action) return

  if (action.type === 'create') {
    e.preventDefault()
    notes.create()
  } else if (action.type === 'focusSearch') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('.sidebar-search input')?.focus()
  } else if (action.type === 'clearQuery') {
    e.preventDefault()
    ui.query = ''
  }
}

// 点更多菜单外部则关闭
function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (moreOpen.value && !target.closest('.more-menu')) moreOpen.value = false
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <TokenGate v-if="!hasToken" />

  <div v-else class="layout" :data-mobile-pane="mobilePane">
    <aside class="sidebar-pane">
      <GroupSidebar />
    </aside>

    <section class="list-pane">
      <TrashView v-if="ui.view === 'trash'" />
      <NoteList v-else />
    </section>

    <main class="editor-pane">
      <div class="editor-top-bar">
        <!-- 移动端返回按钮，仅 <720px 显示 -->
        <button class="back-btn" title="返回列表" @click="backToList">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span class="top-title">{{ notes.current?.title || '选择或新建一条笔记' }}</span>

        <!-- 更多操作菜单（原站 clz_more_icon_div）：置顶/星标/颜色/移至分组/删除 -->
        <div v-if="notes.current" class="more-menu" :class="{ open: moreOpen }">
          <button class="more-btn" title="更多" @click="moreOpen = !moreOpen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          <div v-if="moreOpen" class="more-popover" @click.stop>
            <button class="more-item" @click="notes.current && notes.setProps(notes.current.id, { top: notes.current.top === 1 ? 0 : 1 })">
              {{ notes.current?.top === 1 ? '取消置顶' : '置顶' }}
            </button>
            <button class="more-item" @click="notes.current && notes.setProps(notes.current.id, { star: notes.current.star === 1 ? 0 : 1 })">
              {{ notes.current?.star === 1 ? '取消星标' : '星标' }}
            </button>
            <div class="more-colors">
              <button
                v-for="color in SKIN_COLORS"
                :key="color ?? 'none'"
                class="more-swatch"
                :class="{ 'is-none': color === null }"
                :style="color ? { backgroundColor: color } : undefined"
                :title="color ? '标记颜色' : '清除颜色'"
                @click="notes.current && notes.setProps(notes.current.id, { skin_color: color })"
              />
            </div>
            <label class="more-group">
              移至分组
              <select
                :value="notes.current?.group_id ?? ''"
                @change="notes.current && notes.setProps(notes.current.id, { group_id: ($event.target as HTMLSelectElement).value || null })"
              >
                <option value="">未分组</option>
                <option v-for="g in groups.groups" :key="g.group_id" :value="g.group_id">{{ g.name }}</option>
              </select>
            </label>
            <button class="more-item danger" @click="notes.current && notes.trash(notes.current.id); moreOpen = false">删除</button>
          </div>
        </div>
      </div>
      <div class="editor-body">
        <p v-if="!notes.current" class="placeholder">选择或新建一条笔记</p>
        <MilkdownEditor
          v-else
          :note-id="notes.current.id"
          :model-value="notes.current.body"
          @update:model-value="(md: string) => notes.saveBody(notes.current!.id, md)"
          @flush="(id: string, md: string) => notes.saveBody(id, md)"
        />
      </div>
    </main>

    <!-- 浮动新建按钮（UI 规格 §4.2）：fixed、圆形 54px、--create-yellow -->
    <button class="create-btn" title="新建笔记" @click="notes.create()">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  </div>
</template>
