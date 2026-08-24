<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import MilkdownEditor from '../editor/MilkdownEditor.vue'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'

const props = withDefaults(defineProps<{ readonly?: boolean }>(), { readonly: false })
defineEmits<{ back: [] }>()

const notes = useNotesStore()
const groups = useGroupsStore()

/** 6 色皮肤板（UI 规格 §3.5）。null 为清除。 */
const SKIN_COLORS = [null, '#fed634', '#ffac00', '#e97663', '#5e7a88', '#3692f5'] as const

/** 顶栏里唯一展开的浮层；颜色和分组要选，塞不进一个图标 */
const openPop = ref<'color' | 'group' | null>(null)

function toggle(pop: 'color' | 'group') {
  openPop.value = openPop.value === pop ? null : pop
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (openPop.value && !target.closest('.op-wrap')) openPop.value = null
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

function onBody(md: string) {
  if (props.readonly) return
  if (notes.current) notes.saveBody(notes.current.id, md)
}

function onFlush(id: string, md: string) {
  if (props.readonly) return
  notes.saveBody(id, md)
}

async function purge() {
  if (!notes.current) return
  if (!confirm('彻底删除后无法恢复。确定继续？')) return
  await notes.purge(notes.current.id)
}
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

      <!-- 回收站详情：只读，动作换成恢复 / 彻底删除 -->
      <template v-if="readonly">
        <span class="trash-notice">此笔记在回收站中</span>
        <div v-if="notes.current" class="op-bar">
          <button class="trash-op recover" data-op="recover" @click="notes.recover(notes.current.id)">恢复</button>
          <button class="trash-op purge" data-op="purge" @click="purge">彻底删除</button>
        </div>
      </template>

      <!--
        编辑态：标题不再重复展示（列表里已经有一份），三个点里的动作直接摊成一排。
        对照原站 .clz_editor_op_btn —— 32px 圆形按钮、选中态 #f0f0f0 底。
      -->
      <div v-else-if="notes.current" class="op-bar">
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
            @click="toggle('color')"
          >
            <span
              class="op-dot"
              :class="{ 'is-none': !notes.current.skin_color }"
              :style="notes.current.skin_color ? { backgroundColor: notes.current.skin_color } : undefined"
            />
          </button>

          <div v-if="openPop === 'color'" class="op-popover colors">
            <button
              v-for="color in SKIN_COLORS"
              :key="color ?? 'none'"
              class="more-swatch"
              :class="{ 'is-none': color === null }"
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
            @click="toggle('group')"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </button>

          <div v-if="openPop === 'group'" class="op-popover groups-pop">
            <button
              class="group-opt"
              :class="{ selected: notes.current.group_id === null }"
              @click="notes.current && notes.setProps(notes.current.id, { group_id: null }); openPop = null"
            >
              未分组
            </button>
            <button
              v-for="g in groups.groups"
              :key="g.group_id"
              class="group-opt"
              :class="{ selected: notes.current.group_id === g.group_id }"
              @click="notes.current && notes.setProps(notes.current.id, { group_id: g.group_id }); openPop = null"
            >
              {{ g.name }}
            </button>
          </div>
        </div>

        <button
          class="op-btn danger"
          data-op="trash"
          title="删除"
          aria-label="删除"
          @click="notes.trash(notes.current.id)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
          </svg>
        </button>
      </div>
    </div>

    <div class="editor-body">
      <p v-if="!notes.current" class="placeholder">选择或新建一条笔记</p>
      <MilkdownEditor
        v-else
        :note-id="notes.current.id"
        :model-value="notes.current.body"
        :editable="!readonly"
        @update:model-value="onBody"
        @flush="onFlush"
      />
    </div>
  </main>
</template>
