<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { descendantsOf, flattenToc } from '../../shared/knowledge-base'
import { countWords } from '../../shared/derive'
import type { TocNode } from '../../shared/knowledge-base'
import { useUiStore } from '../stores/ui'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import { useNotesStore } from '../stores/notes'
import { isMobile, pushNav, showKnowledgeBases } from '../navigation'
import { metadata, updateKnowledgeBase } from '../db/knowledge-base-repo'
import { workspacePreferences, togglePinnedKnowledgeBase } from '../workspace-preferences'
import type { KnowledgeBaseMeta } from '../../shared/knowledge-base'
import AppIcon from './AppIcon.vue'
import ActionMenu from './ActionMenu.vue'
import KnowledgeBaseForm from './KnowledgeBaseForm.vue'

defineProps<{ embedded?: boolean }>()

const ui = useUiStore()
const libraries = useKnowledgeBasesStore()
const notes = useNotesStore()
const book = computed(() => libraries.books.find((b) => b.id === ui.activeKnowledgeBaseId))
const toc = computed(() => libraries.tocs.find((t) => t.knowledge_base_id === book.value?.id))
const noteMap = computed(() => new Map(libraries.notes.map((note) => [note.id, note])))
const pinned = computed(() => !!book.value && workspacePreferences.value.pinnedKnowledgeBaseIds.includes(book.value.id))
const menuOpen = ref(false)
const menuTrigger = ref<HTMLElement | null>(null)
const formOpen = ref(false)
const busy = ref(false)
const error = ref('')
watch(
  () => book.value?.id,
  () => {
    menuOpen.value = false
    formOpen.value = false
    error.value = ''
  },
)
const visibleNodes = computed(() => {
  const nodes = toc.value?.nodes ?? []
  const states = new Map(libraries.noteStates.map((note) => [note.id, note.state]))
  const hidden = new Set(
    nodes
      .filter((node) => {
        if (!node.note_id) return false
        const note = noteMap.value.get(node.note_id)
        return note ? note.invalid !== 0 : ['trash', 'purged'].includes(states.get(node.note_id) ?? '')
      })
      .map((node) => node.id),
  )
  for (const folder of nodes.filter((node) => node.kind === 'folder')) {
    const subtree = descendantsOf(nodes, folder.id)
    const refs = nodes.filter((node) => subtree.has(node.id) && node.kind === 'note')
    if (refs.length && refs.every((node) => hidden.has(node.id))) for (const id of subtree) hidden.add(id)
  }
  return nodes.filter((node) => !hidden.has(node.id))
})
const rows = computed(() => flattenToc(visibleNodes.value))
const activeNotes = computed(() =>
  rows.value.flatMap(({ node }) => {
    const note = node.note_id ? noteMap.value.get(node.note_id) : undefined
    return note?.invalid === 0 ? [note] : []
  }),
)
const noteCount = computed(() => activeNotes.value.length)
const wordCount = computed(() => activeNotes.value.reduce((total, note) => total + countWords(libraries.bodyText.get(note.id) ?? '').words, 0))
const folderCount = computed(() => rows.value.filter(({ node }) => node.kind === 'folder').length)
const number = (value: number) => value.toLocaleString('zh-CN')
const date = (time: number) => {
  const value = new Date(time)
  return `${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}
function label(node: TocNode): string {
  if (node.kind === 'folder') return node.title || '未命名章节'
  const note = noteMap.value.get(node.note_id!)
  return note ? note.title || '无标题' : '笔记尚未同步到本机'
}
function openNote(node: TocNode) {
  if (node.kind === 'folder') return
  const note = noteMap.value.get(node.note_id!)
  if (!note) return
  if (isMobile()) pushNav()
  ui.activeTocNodeId = node.id
  notes.open(note.id)
}
function edit() {
  menuOpen.value = false
  error.value = ''
  formOpen.value = true
}
async function save(info: KnowledgeBaseMeta) {
  if (!book.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await updateKnowledgeBase(book.value.id, info)
    formOpen.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="knowledge-base-home" :class="{ 'editor-pane': !embedded, embedded }" aria-label="笔记本首页">
    <div v-if="book && !book.invalid" class="kb-home-content">
      <article class="kb-home-card">
        <header class="kb-home-hero">
          <div class="kb-home-identity">
            <span class="kb-home-icon" aria-hidden="true"
              ><AppIcon v-if="!book.icon || book.icon === '📚'" name="book" :size="32" /><span v-else>{{ book.icon }}</span></span
            >
            <div class="kb-home-heading">
              <h1>{{ book.name }}</h1>
              <p class="kb-home-stats">
                <b>{{ number(noteCount) }}</b> 文档 <i aria-hidden="true">·</i> <b>{{ number(wordCount) }}</b> 字
              </p>
            </div>
          </div>
          <div class="kb-home-actions">
            <button type="button" class="kb-home-pin" :aria-pressed="pinned" @click="togglePinnedKnowledgeBase(book.id)">
              <AppIcon name="pin" :size="16" />{{ pinned ? '已固定' : '固定' }}
            </button>
            <button
              ref="menuTrigger"
              type="button"
              class="kb-home-more icon-button"
              aria-label="首页更多操作"
              title="更多操作"
              aria-haspopup="menu"
              :aria-expanded="menuOpen"
              @click="menuOpen = !menuOpen"
              @keydown.down.prevent="menuOpen = true"
            >
              <AppIcon name="more" :size="20" />
            </button>
          </div>
        </header>

        <section class="kb-home-intro" aria-label="知识库简介">
          <h2><span aria-hidden="true">👋</span> 欢迎来到知识库</h2>
          <p>{{ book.description || '在这里整理文档，记录想法。' }}</p>
        </section>

        <section v-if="!embedded" class="kb-home-documents" aria-label="知识库目录">
          <header class="kb-home-section-head">
            <h2>目录</h2>
            <span>{{ folderCount ? `${folderCount} 个章节 · ` : '' }}{{ noteCount }} 篇笔记</span>
          </header>
          <div v-if="rows.length" class="kb-home-list">
            <div
              v-for="{ node, depth } in rows"
              :key="node.id"
              class="kb-home-row"
              :class="{ 'is-folder': node.kind === 'folder' }"
              :style="{ paddingLeft: `${Math.min(depth, 5) * 16 + 4}px` }"
            >
              <button
                class="kb-home-row-main"
                :disabled="node.kind === 'folder' || !noteMap.has(node.note_id!)"
                :aria-label="node.kind === 'folder' ? `章节：${label(node)}` : `打开笔记：${label(node)}`"
                @click="openNote(node)"
              >
                <AppIcon :name="node.kind === 'folder' ? 'folder' : 'note'" :size="18" />
                <span>{{ label(node) }}</span>
              </button>
              <time
                v-if="node.kind === 'note' && noteMap.get(node.note_id!)"
                :datetime="new Date(noteMap.get(node.note_id!)!.update_time).toISOString()"
                >{{ date(noteMap.get(node.note_id!)!.update_time) }}</time
              >
            </div>
          </div>
          <p v-else class="kb-home-empty">目录还是空的，新建一篇笔记开始吧。</p>
        </section>
      </article>
      <ActionMenu :open="menuOpen" :anchor="menuTrigger" label="首页操作" @close="menuOpen = false">
        <button
          type="button"
          class="menu-item"
          role="menuitem"
          @click="edit"
        >
          <AppIcon name="edit" :size="15" />编辑笔记本
        </button>
      </ActionMenu>
      <KnowledgeBaseForm :open="formOpen" :initial="metadata(book)" :busy="busy" :error="error" @save="save" @close="formOpen = false" />
    </div>
    <div v-else class="kb-home-content">
      <h1>笔记本不可用</h1>
      <button class="dialog-btn cancel" @click="showKnowledgeBases()">返回笔记本列表</button>
    </div>
  </section>
</template>

<style scoped>
.knowledge-base-home {
  overflow: auto;
  background: var(--bg-list);
  container-type: inline-size;
}
.kb-home-content {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px clamp(20px, 3cqw, 40px);
  flex: none;
  overflow-wrap: anywhere;
}
.kb-home-card {
  padding: 38px clamp(24px, 4cqw, 44px) 32px;
  border: 0;
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-surface) 92%, var(--bg-list));
}
.kb-home-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}
.kb-home-identity {
  display: flex;
  align-items: center;
  gap: 22px;
  min-width: 0;
}
.kb-home-icon {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 54px;
  height: 64px;
  padding-left: 4px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border-light));
  border-radius: 5px 9px 9px 5px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 28px;
  line-height: 1;
  box-shadow:
    2px 3px 0 var(--bg-surface),
    3px 4px 0 var(--border-light);
}
.kb-home-icon::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 5px;
  width: 1px;
  background: color-mix(in srgb, var(--accent) 24%, transparent);
}
.kb-home-heading {
  min-width: 0;
}
.kb-home-heading h1 {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(26px, 3vw, 36px);
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.04em;
  overflow-wrap: anywhere;
}
.kb-home-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 7px;
  margin: 12px 0 0;
  color: var(--text-tertiary);
  font-size: 16px;
}
.kb-home-stats b {
  color: var(--text-secondary);
  font-size: 20px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.kb-home-stats i {
  color: var(--border-input);
  font-style: normal;
}
.kb-home-more {
  flex: none;
  border: 1px solid var(--border-default);
  border-radius: 7px;
}
.kb-home-more:hover {
  background: var(--bg-hover);
}
.kb-home-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.kb-home-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-surface);
  font-size: 13px;
  color: var(--text-secondary);
}
.kb-home-pin:hover {
  background: var(--bg-hover);
}
.kb-home-pin[aria-pressed='true'] {
  color: var(--accent);
  border-color: var(--focus-ring);
  background: var(--accent-soft);
}
.kb-home-intro {
  max-width: 780px;
  margin: 32px 0 0;
}
.kb-home-intro h2,
.kb-home-section-head h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 650;
  line-height: 1.5;
}
.kb-home-intro h2 span {
  margin-right: 7px;
}
.kb-home-intro p {
  margin: 16px 0 0;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1.9;
  white-space: pre-wrap;
}
.kb-home-documents {
  margin-top: 32px;
}
.kb-home-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}
.kb-home-section-head span {
  color: var(--text-tertiary);
  font-size: 13px;
}
.kb-home-list {
  border-bottom: 1px solid var(--border-light);
}
.kb-home-row {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 52px;
  border-bottom: 1px dashed var(--border-light);
}
.kb-home-row:last-child {
  border-bottom: 0;
}
.kb-home-row > time {
  flex: none;
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.kb-home-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
  padding: 7px 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  font-size: 15px;
}
.kb-home-row-main .app-icon {
  flex: none;
  color: var(--accent);
}
.kb-home-row-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kb-home-row-main:not(:disabled):hover {
  color: var(--accent);
}
.kb-home-row.is-folder .kb-home-row-main {
  color: var(--text-secondary);
  font-weight: 600;
  cursor: default;
}
.kb-home-row.is-folder .kb-home-row-main .app-icon {
  color: var(--text-tertiary);
}
.kb-home-empty {
  margin: 0;
  padding: 22px 4px;
  color: var(--text-tertiary);
  font-size: 14px;
}
@container (max-width: 700px) {
  .kb-home-content {
    padding: 16px 14px 24px;
  }
  .kb-home-card {
    padding: 32px 20px 28px;
    border-radius: 12px;
  }
  .kb-home-icon {
    width: 46px;
    height: 56px;
  }
  .kb-home-identity {
    gap: 16px;
  }
  .kb-home-hero {
    flex-wrap: wrap;
    gap: 20px;
  }
  .kb-home-heading h1 {
    font-size: 26px;
  }
  .kb-home-stats {
    font-size: 14px;
  }
  .kb-home-stats b {
    font-size: 17px;
  }
  .kb-home-intro {
    margin-top: 28px;
  }
  .kb-home-intro p {
    font-size: 15px;
  }
  .kb-home-documents {
    margin-top: 28px;
  }
  .kb-home-row {
    gap: 10px;
    min-height: 48px;
  }
  .kb-home-row > time {
    font-size: 11px;
  }
  .kb-home-row-main {
    font-size: 14px;
  }
}
.knowledge-base-home.embedded {
  overflow: visible;
  background: transparent;
}
.embedded .kb-home-content {
  padding: 0;
}
.embedded .kb-home-card {
  min-height: 0;
  padding: 24px 18px;
  border: 0;
  border-bottom: 1px solid var(--border-light);
  border-radius: 0;
}
.embedded .kb-home-heading h1 {
  font-size: 24px;
}
.embedded .kb-home-intro h2 {
  font-size: 16px;
}
.embedded .kb-home-intro {
  margin-top: 24px;
}
.embedded .kb-home-intro p {
  margin-top: 10px;
  font-size: 14px;
}
</style>
