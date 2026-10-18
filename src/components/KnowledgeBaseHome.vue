<script setup lang="ts">
import { computed, ref } from 'vue'
import { flattenToc } from '../../shared/knowledge-base'
import { useUiStore } from '../stores/ui'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import { useNotesStore } from '../stores/notes'
import { openNotebookLink, showKnowledgeBases } from '../navigation'
import AppIcon from './AppIcon.vue'
import KnowledgeBaseInfo from './KnowledgeBaseInfo.vue'
const ui = useUiStore()
const libraries = useKnowledgeBasesStore()
const book = computed(() => libraries.books.find(b => b.id === ui.activeKnowledgeBaseId))
const paths = computed(() => new Map(flattenToc(libraries.tocs.find(t => t.knowledge_base_id === book.value?.id)?.nodes ?? []).filter(row => row.node.note_id).map(row => [row.node.note_id!, row.path.join(' / ')])))
const recent = computed(() => libraries.notes.filter(note => !note.invalid && paths.value.has(note.id)).sort((a, b) => b.update_time - a.update_time || a.id.localeCompare(b.id)).slice(0, 6))
const busy = ref(false)
const error = ref('')
async function create() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await useNotesStore().create() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
const date = (time: number) => new Date(time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
</script>

<template>
  <section class="editor-pane knowledge-base-home" aria-label="笔记本首页">
    <header v-if="book && !book.invalid && !book.deleted" class="kb-home-toolbar"><span><AppIcon name="book" :size="16" />笔记本首页</span><button type="button" :disabled="busy" @click="create"><AppIcon name="plus" :size="15" />在此笔记本新建笔记</button></header>
    <div v-if="book && !book.invalid && !book.deleted" class="kb-home-content">
      <KnowledgeBaseInfo :book="book" />
      <p v-if="error" class="kb-home-error" role="alert">{{ error }}</p>
      <section class="kb-recent-section" aria-label="最近编辑">
        <header><h2>最近编辑</h2><span>{{ recent.length ? '从上次停下的地方继续' : '每一个主题，都从第一篇开始' }}</span></header>
        <div v-if="recent.length" class="kb-recent-list">
          <button v-for="(note, index) in recent" :key="note.id" type="button" class="kb-recent-note" :aria-label="`继续编辑：${note.title || '无标题'}`" @click="openNotebookLink(book.id, note.id)">
            <span class="kb-recent-icon"><AppIcon name="note" :size="19" /></span><span class="kb-recent-text"><strong>{{ note.title || '无标题' }}</strong><small>{{ note.summary || '还没有正文，继续写一点…' }}</small><span class="kb-recent-meta">{{ paths.get(note.id) || '根目录' }}<span>·</span>{{ date(note.update_time) }}</span></span><span v-if="index === 0" class="kb-resume-label">继续编辑</span><AppIcon name="chevron" :size="15" class="kb-recent-arrow" />
          </button>
        </div>
        <div v-else class="kb-home-empty"><AppIcon name="note" :size="30" /><p>这里将收录你的思考和发现</p><button type="button" :disabled="busy" @click="create">写下第一篇<AppIcon name="chevron" :size="14" /></button></div>
      </section>
    </div>
    <div v-else class="kb-home-content"><h1>笔记本不可用</h1><button class="dialog-btn cancel" @click="showKnowledgeBases()">返回笔记本列表</button></div>
  </section>
</template>

<style scoped>
.knowledge-base-home { overflow: auto; background: var(--bg-app); }
.kb-home-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: var(--header-height); padding: 12px 24px; border-bottom: 1px solid var(--border-light); background: var(--bg-surface); flex: none; }
.kb-home-toolbar > span { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-tertiary); }
.kb-home-toolbar button { display: flex; align-items: center; gap: 6px; padding: 7px 10px; background: var(--accent-soft); color: var(--selected-text); border: 0; border-radius: 6px; font-size: 12px; }
.kb-home-content { width: 100%; max-width: 960px; margin: 0 auto; padding: 32px clamp(20px, 3vw, 40px) 48px; overflow-wrap: anywhere; }
.kb-recent-section { margin-top: 32px; }
.kb-recent-section > header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.kb-recent-section h2 { margin: 0; font-size: 15px; font-weight: 600; }
.kb-recent-section > header > span { font-size: 11px; color: var(--text-tertiary); }
.kb-recent-list { overflow: hidden; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-surface); }
.kb-recent-note { display: flex; align-items: center; gap: 14px; width: 100%; min-width: 0; padding: 18px 20px; border: 0; background: transparent; color: var(--text-primary); text-align: left; }
.kb-recent-note + .kb-recent-note { border-top: 1px solid var(--border-light); }
.kb-recent-note:hover { background: var(--bg-hover); }
.kb-recent-note:focus-visible { outline-offset: -3px; }
.kb-recent-icon { color: var(--accent); flex: none; }
.kb-recent-text { flex: 1; min-width: 0; }
.kb-recent-text strong, .kb-recent-text small { display: block; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.kb-recent-text strong { font-size: 14px; font-weight: 550; }
.kb-recent-text small { margin-top: 5px; font-size: 12px; color: var(--text-secondary); }
.kb-recent-meta { display: flex; gap: 8px; margin-top: 8px; font-size: 10px; color: var(--text-tertiary); }
.kb-resume-label { flex: none; font-size: 11px; color: var(--accent); }
.kb-recent-arrow { flex: none; color: var(--text-tertiary); }
.kb-home-empty { padding: 32px 20px; text-align: center; border: 1px dashed var(--border-default); border-radius: var(--radius-md); color: var(--text-tertiary); }
.kb-home-empty p { margin: 12px 0; font-size: 13px; }
.kb-home-empty button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--accent); font-size: 13px; }
.kb-home-error { color: var(--danger); font-size: 13px; }
@container (max-width: 480px) { .kb-home-toolbar { padding: 12px 16px; } .kb-home-toolbar > span { display: none; } .kb-recent-section > header { display: block; } .kb-recent-section > header > span { display: block; margin-top: 6px; } .kb-resume-label { display: none; } }
</style>
