<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { countWords } from '../../shared/derive'
import type MilkdownEditorComponent from '../editor/MilkdownEditor.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import ConfirmDialog from './ConfirmDialog.vue'
import NoteInfoDialog from './NoteInfoDialog.vue'
import WordCountDialog from './WordCountDialog.vue'
import AppIcon from './AppIcon.vue'
import EditorLoading from './EditorLoading.vue'
import { useUiStore } from '../stores/ui'

const MilkdownEditor = defineAsyncComponent({
  loader: () => import('../editor/MilkdownEditor.vue'),
  loadingComponent: EditorLoading,
  delay: 120,
})

const props = withDefaults(defineProps<{ readonly?: boolean }>(), { readonly: false })
defineEmits<{ back: [] }>()

const notes = useNotesStore()
const groups = useGroupsStore()
const ui = useUiStore()
const editorBody = ref<HTMLElement | null>(null)
const currentGroup = computed(() => groups.groups.find(group => group.group_id === notes.current?.group_id)?.name ?? '未分组')

/** 6 色皮肤板（UI 规格 §3.5）。null 为清除。 */
const SKIN_COLORS = [null, '#fed634', '#ffac00', '#e97663', '#5e7a88', '#3692f5'] as const

/** 颜色、分组和格式提示一次只展开一个。 */
const openPop = ref<'color' | 'group' | 'help' | null>(null)

async function toggle(pop: 'color' | 'group' | 'help') {
  openPop.value = openPop.value === pop ? null : pop
  if (openPop.value) {
    await nextTick()
    document.querySelector<HTMLButtonElement>('.op-popover button')?.focus()
  }
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (openPop.value && !target.closest('.op-wrap')) openPop.value = null
}

function onPopoverKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !openPop.value) return
  const trigger = openPop.value
  event.preventDefault()
  event.stopPropagation()
  openPop.value = null
  document.querySelector<HTMLButtonElement>(`[data-op="${trigger}"]`)?.focus()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onPopoverKeydown, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onPopoverKeydown, true)
})

watch(() => notes.currentId, async () => {
  openPop.value = null
  await nextTick()
  if (editorBody.value) editorBody.value.scrollTop = 0
})

function onBody(md: string, base: string) {
  if (props.readonly) return
  if (notes.current) notes.saveBody(notes.current.id, md, base)
}

function onFlush(id: string, md: string, base: string) {
  if (props.readonly) return
  notes.saveBody(id, md, base)
}

/** 触发编辑器里的撤销/重做（history 插件）；只读态顶栏不渲染这两个钮，为空安全 */
const editorRef = ref<InstanceType<typeof MilkdownEditorComponent> | null>(null)

async function toggleFocus() {
  ui.focusMode = !ui.focusMode
  await nextTick()
  editorBody.value?.querySelector<HTMLElement>('.ProseMirror')?.focus()
}

/** 删除动作统一定点到这个弹窗；null = 未打开 */
const confirmAction = ref<'trash' | 'purge' | null>(null)

function runDelete() {
  if (confirmAction.value === 'trash' && notes.current) {
    notes.trash(notes.current.id)
  } else if (confirmAction.value === 'purge' && notes.current) {
    notes.purge(notes.current.id)
  }
  confirmAction.value = null
}

/** 文档信息 / 字数统计弹窗开关 */
const showInfo = ref(false)
const showWordCount = ref(false)

/** 当前笔记字数统计（实时随正文变化） */
const wordCount = computed(() => countWords(notes.current?.body ?? ''))
</script>

<template>
  <main class="editor-pane">
    <div class="editor-top-bar">
      <!-- 移动端返回按钮，仅 <720px 显示 -->
      <button class="back-btn" title="返回列表" aria-label="返回列表" @click="$emit('back')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <div v-if="!readonly" class="editor-location" :title="notes.current ? currentGroup : '随手记录'">
        <AppIcon :name="notes.current ? 'folder' : 'note'" :size="16" />
        <span>{{ notes.current ? currentGroup : '随手记录' }}</span>
      </div>

      <!-- 回收站详情：只读，动作换成恢复 / 彻底删除 -->
      <template v-if="readonly">
        <span v-if="notes.current" class="trash-notice">此笔记在回收站中</span>
        <div v-if="notes.current" class="op-bar">
          <button class="trash-op recover" data-op="recover" @click="notes.recover(notes.current.id)">恢复</button>
          <button class="trash-op purge" data-op="purge" @click="confirmAction = 'purge'">彻底删除</button>
        </div>
      </template>

      <!--
        编辑态：标题不再重复展示（列表里已经有一份），三个点里的动作直接摊成一排。
        对照原站 .clz_editor_op_btn —— 32px 圆形按钮、选中态 #f0f0f0 底。
      -->
      <div v-else-if="notes.current" class="op-bar">
        <button class="op-btn" data-op="undo" title="撤销 (Ctrl+Z)" aria-label="撤销" @click="editorRef?.undo?.()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>

        <button class="op-btn" data-op="redo" title="重做 (Ctrl+Y)" aria-label="重做" @click="editorRef?.redo?.()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        <span class="op-separator" aria-hidden="true"></span>

        <button
          class="op-btn"
          data-op="top"
          :class="{ selected: notes.current.top === 1 }"
          :title="notes.current.top === 1 ? '取消置顶' : '置顶'"
          :aria-label="notes.current.top === 1 ? '取消置顶' : '置顶'"
          :aria-pressed="notes.current.top === 1"
          @click="notes.setProps(notes.current.id, { top: notes.current.top === 1 ? 0 : 1 })"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"
            />
          </svg>
        </button>

        <button
          class="op-btn"
          data-op="star"
          :class="{ selected: notes.current.star === 1 }"
          :title="notes.current.star === 1 ? '取消星标' : '星标'"
          :aria-label="notes.current.star === 1 ? '取消星标' : '星标'"
          :aria-pressed="notes.current.star === 1"
          @click="notes.setProps(notes.current.id, { star: notes.current.star === 1 ? 0 : 1 })"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
          </svg>
        </button>

        <div class="op-wrap">
          <button
            class="op-btn"
            data-op="color"
            :class="{ open: openPop === 'color' }"
            title="标记颜色"
            aria-label="标记颜色"
            aria-haspopup="true"
            :aria-expanded="openPop === 'color'"
            @click="toggle('color')"
          >
            <span
              class="op-dot"
              :class="{ 'is-none': !notes.current.skin_color }"
              :style="notes.current.skin_color ? { backgroundColor: notes.current.skin_color } : undefined"
            />
          </button>

          <div v-if="openPop === 'color'" class="op-popover colors" role="group" aria-label="选择标记颜色">
            <button
              v-for="color in SKIN_COLORS"
              :key="color ?? 'none'"
              class="more-swatch"
              :class="{ 'is-none': color === null }"
              :aria-pressed="notes.current.skin_color === color"
              :style="color ? { backgroundColor: color } : undefined"
              :title="color ? '标记颜色' : '清除颜色'"
              :aria-label="color ? `标记颜色 ${color}` : '清除颜色'"
              @click="notes.current && notes.setProps(notes.current.id, { skin_color: color }); openPop = null"
            />
          </div>
        </div>

        <div class="op-wrap">
          <button
            class="op-btn"
            data-op="group"
            :class="{ open: openPop === 'group' }"
            title="移至分组"
            aria-label="移至分组"
            aria-haspopup="true"
            :aria-expanded="openPop === 'group'"
            @click="toggle('group')"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </button>

          <div v-if="openPop === 'group'" class="op-popover groups-pop" role="group" aria-label="选择分组">
            <span class="popover-heading">移至分组</span>
            <button
              class="group-opt"
              :class="{ selected: notes.current.group_id === null }"
              :aria-pressed="notes.current.group_id === null"
              @click="notes.current && notes.setProps(notes.current.id, { group_id: null }); openPop = null"
            >
              未分组
            </button>
            <button
              v-for="g in groups.groups"
              :key="g.group_id"
              class="group-opt"
              :class="{ selected: notes.current.group_id === g.group_id }"
              :aria-pressed="notes.current.group_id === g.group_id"
              @click="notes.current && notes.setProps(notes.current.id, { group_id: g.group_id }); openPop = null"
            >
              {{ g.name }}
            </button>
          </div>
        </div>

        <span class="op-separator" aria-hidden="true"></span>
        <button class="op-btn focus-toggle" data-op="focus" :class="{ selected: ui.focusMode }" :aria-pressed="ui.focusMode" :title="ui.focusMode ? '退出专注模式 (Esc)' : '专注模式'" :aria-label="ui.focusMode ? '退出专注模式' : '专注模式'" @click="toggleFocus">
          <AppIcon :name="ui.focusMode ? 'collapse' : 'focus'" />
        </button>

        <button
          class="op-btn danger"
          data-op="trash"
          title="删除"
          aria-label="删除"
          @click="confirmAction = 'trash'"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
          </svg>
        </button>
      </div>
    </div>

    <div ref="editorBody" class="editor-body">
      <div v-if="!notes.current" class="editor-welcome">
        <div class="welcome-paper" aria-hidden="true"><AppIcon name="note" :size="44" /></div>
        <h1>{{ readonly ? '让想法，暂时歇一歇' : '随手记下，此刻的想法' }}</h1>
        <p>{{ readonly ? '选择一条笔记查看，或将它恢复到列表。' : '选择一条笔记，或新建一条，开始记录。' }}</p>
        <button v-if="!readonly" class="welcome-create" @click="notes.create()"><AppIcon name="plus" :size="17" />新建笔记</button>
        <span v-if="!readonly" class="welcome-tip">灵感、清单、小事，都可以放在这里。</span>
      </div>
      <MilkdownEditor
        v-else
        ref="editorRef"
        :note-id="notes.current.id"
        :model-value="notes.current.body"
        :editable="!readonly"
        @update:model-value="onBody"
        @flush="onFlush"
      />
    </div>

    <footer v-if="notes.current" class="editor-footer">
      <span class="autosave"><AppIcon v-if="readonly" name="lock" :size="12" /><span v-else class="status-dot"></span>{{ readonly ? '只读笔记' : '自动保存' }}</span>
      <button class="meta-entry" data-op="wordcount" title="字数统计" aria-label="字数统计" @click="showWordCount = true">{{ wordCount.words }} 字</button>
      <button class="meta-entry" data-op="info" title="文档信息" aria-label="文档信息" @click="showInfo = true"><AppIcon name="info" :size="14" /></button>
      <div v-if="!readonly" class="op-wrap format-help">
        <button class="meta-entry" data-op="help" :aria-expanded="openPop === 'help'" @click="toggle('help')"><AppIcon name="keyboard" :size="15" /><span>格式帮助</span></button>
        <div v-if="openPop === 'help'" class="op-popover help-popover">
          <span class="popover-heading">用简单符号，轻松排版</span>
          <dl><div><dt><code># 空格</code></dt><dd>标题</dd></div><div><dt><code>- 空格</code></dt><dd>无序列表</dd></div><div><dt><code>1. 空格</code></dt><dd>有序列表</dd></div><div><dt><code>&gt; 空格</code></dt><dd>引用</dd></div><div><dt><code>**文字**</code></dt><dd>加粗</dd></div></dl>
          <p>也可以直接粘贴文字或图片。</p>
        </div>
      </div>
    </footer>

    <!-- 删除统一先确认：移入回收站可恢复，彻底删除不可恢复 -->
    <ConfirmDialog
      :open="confirmAction !== null"
      :title="confirmAction === 'purge' ? '彻底删除这条笔记？' : '删除这条笔记？'"
      :message="confirmAction === 'purge' ? '彻底删除后无法恢复，请谨慎操作。' : '笔记会移入回收站，可随时恢复。'"
      :confirm-text="confirmAction === 'purge' ? '彻底删除' : '删除'"
      @confirm="runDelete"
      @cancel="confirmAction = null"
    />

    <NoteInfoDialog :open="showInfo" :note="notes.current" @close="showInfo = false" />
    <WordCountDialog :open="showWordCount" :count="wordCount" @close="showWordCount = false" />
  </main>
</template>
