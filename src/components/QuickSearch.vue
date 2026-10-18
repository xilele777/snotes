<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import { liveQuery, type Subscription } from 'dexie'
import { db } from '../db/schema'
import { isNoteHiddenFromHome } from '../db/repo'
import { isMobile, openNotebookLink, showKnowledgeBases, switchListView } from '../navigation'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { syncNow } from '../sync/engine'
import { searchWorkspace, type SearchDestination } from '../global-search'
import AppIcon from './AppIcon.vue'
import { highlight } from './SearchBar'
import { useDialogFocus } from './useDialogFocus'

const props = defineProps<{ open: boolean; returnFocus?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
const query = ref('')
const selected = ref(0)
const loading = ref(false)
const opening = ref(false)
const error = ref('')
type SearchData = Awaited<ReturnType<typeof readData>>
const data = shallowRef<SearchData | null>(null)
const matches = computed(() => data.value ? searchWorkspace(...data.value, query.value) : [])
const results = computed(() => matches.value.slice(0, query.value.trim() ? 40 : 10))
let subscription: Subscription | undefined
let generation = 0
async function readData() {
  return await Promise.all([db.notes.where('invalid').equals(0).toArray(), db.knowledgeBases.toArray(), db.knowledgeBaseTocs.toArray(), db.groups.toArray()])
}
useDialogFocus(() => props.open, panel, () => emit('close'), () => {
  const previous = props.returnFocus
  return previous?.isConnected && previous.getClientRects().length && !previous.closest('[inert]') && previous !== document.body
    ? previous : [...document.querySelectorAll<HTMLElement>('.kb-header h2, .header-title, .drawer-btn, .back-btn')].find(el => el.getClientRects().length && !el.closest('[inert]')) ?? null
})
watch(() => props.open, open => {
  generation++
  subscription?.unsubscribe()
  if (!open) { data.value = null; return }
  query.value = ''
  error.value = ''
  selected.value = 0
  loading.value = true
  subscription = liveQuery(readData).subscribe({ next: value => { data.value = value; loading.value = false }, error: () => { loading.value = false; error.value = '暂时无法读取笔记，请关闭后重试。' } })
}, { immediate: true })
watch(results, () => { selected.value = Math.min(selected.value, Math.max(0, results.value.length - 1)) })
watch(query, () => { selected.value = 0 })
async function openResult(result: SearchDestination) {
  if (opening.value) return
  opening.value = true
  const request = generation
  error.value = ''
  try {
    // The first pull can deliver note bodies before notebook ownership. Resolve
    // the destination again after that in-progress sync, using fresh local data.
    if (useUiStore().syncing && navigator.onLine) await syncNow()
    const latest = searchWorkspace(...await readData(), '').find(item => item.id === result.id && item.kind === result.kind)
    if (!props.open || request !== generation) return
    if (!latest) { error.value = '这条内容已被移走或删除。'; return }
    result = latest
    if (result.kind === 'book') await showKnowledgeBases(result.id)
    else if (result.bookId) await openNotebookLink(result.bookId, result.id)
    else {
      const note = await db.notes.get(result.id)
      if (!note || note.invalid) { error.value = '这条笔记已被移走或删除。'; return }
      await switchListView(await isNoteHiddenFromHome(note) ? 'hidden' : 'all')
      useNotesStore().open(result.id)
      if (isMobile()) useUiStore().mobilePane = 'editor'
    }
    emit('close')
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { opening.value = false }
}
async function keydown(event: KeyboardEvent) {
  if (event.isComposing || !(event.target instanceof HTMLInputElement)) return
  if (event.key === 'Enter') { event.preventDefault(); if (results.value[selected.value]) await openResult(results.value[selected.value]); return }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  if (!results.value.length) return
  selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) % results.value.length
  await nextTick()
  panel.value?.querySelector(`#quick-search-result-${selected.value}`)?.scrollIntoView({ block: 'nearest' })
}
onUnmounted(() => subscription?.unsubscribe())
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="quick-search-mask" @click.self="emit('close')">
      <section ref="panel" class="quick-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索" @keydown="keydown">
        <header><AppIcon name="search" :size="21" /><input v-model="query" type="search" role="combobox" aria-label="全局搜索笔记" aria-autocomplete="list" aria-expanded="true" aria-controls="quick-search-results" :aria-activedescendant="results.length ? `quick-search-result-${selected}` : undefined" data-autofocus placeholder="搜索笔记、正文或笔记本…" autocomplete="off" /><button class="icon-button" type="button" aria-label="关闭全局搜索" @click="emit('close')"><AppIcon name="close" :size="18" /></button></header>
        <div class="search-results-caption" aria-live="polite">{{ opening ? '正在打开…' : loading ? '正在查找…' : query.trim() ? `${matches.length} 个结果${matches.length > 40 ? ' · 显示前 40 个' : ''}` : '最近更新 · 搜索全部笔记与笔记本' }}</div>
        <p v-if="error" class="quick-search-error" role="alert">{{ error }}</p>
        <div id="quick-search-results" role="listbox" aria-label="搜索结果" :aria-busy="loading" class="quick-search-results">
          <button v-for="(result, index) in results" :id="`quick-search-result-${index}`" :key="`${result.kind}-${result.id}`" type="button" role="option" :aria-selected="selected === index" :disabled="opening" @pointermove="selected = index" @click="openResult(result)">
            <span class="search-result-icon"><AppIcon :name="result.kind === 'book' ? 'book' : 'note'" :size="20" /></span>
            <span class="search-result-text"><strong><span v-for="(segment, i) in highlight(result.title, query)" :key="i" :class="{ hit: segment.hit }">{{ segment.text }}</span></strong><small>{{ result.context }}<template v-if="result.preview"> · {{ result.preview }}</template></small></span><AppIcon name="back" :size="16" class="search-result-enter" />
          </button>
          <div v-if="!loading && !results.length && !error" class="quick-search-empty"><AppIcon name="search" :size="32" /><p>{{ query.trim() ? '没有找到相关内容' : '从第一条笔记开始' }}</p><small>{{ query.trim() ? '换个关键词，或用空格组合多个词。' : '记录之后，就可以在这里快速找回。' }}</small></div>
        </div>
        <footer><span><kbd>↑ ↓</kbd> 选择 <kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.quick-search-mask { position: fixed; inset: 0; z-index: 100; display: flex; justify-content: center; align-items: flex-start; padding: min(16vh, 120px) 20px 20px; background: var(--mask); backdrop-filter: blur(5px); }
.quick-search-dialog { display: flex; flex-direction: column; width: 620px; max-width: 100%; max-height: min(620px, 78dvh); background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-default); border-radius: var(--radius-lg); box-shadow: var(--shadow-floating); overflow: hidden; }
header { display: flex; align-items: center; gap: 14px; padding: 18px 20px; border-bottom: 1px solid var(--border-light); color: var(--accent); }
input { flex: 1; width: 0; min-width: 0; padding: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font-size: 16px; }
.search-results-caption { padding: 14px 22px 8px; color: var(--text-tertiary); font-size: 11px; }
.quick-search-results { overflow-y: auto; min-height: 0; padding: 4px 10px 12px; }
.quick-search-results > button { display: flex; align-items: center; gap: 14px; width: 100%; padding: 12px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-primary); text-align: left; }
.quick-search-results > button[aria-selected='true'] { background: var(--selected-bg); }
.search-result-icon { display: grid; place-items: center; width: 38px; height: 42px; flex: none; border: 1px solid var(--border-default); border-radius: 7px; background: var(--bg-surface); color: var(--accent); }
.search-result-text { flex: 1; min-width: 0; }
.search-result-text strong, .search-result-text small { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.search-result-text strong { font-size: 14px; font-weight: 600; }
.search-result-text small { margin-top: 4px; font-size: 12px; color: var(--text-tertiary); }
.search-result-enter { transform: rotate(180deg); color: var(--text-tertiary); }
.hit { color: var(--accent); }
footer { display: flex; justify-content: space-between; gap: 8px; padding: 10px 20px; border-top: 1px solid var(--border-light); background: var(--bg-list); color: var(--text-tertiary); font-size: 11px; }
kbd { padding: 2px 4px; margin-right: 4px; border: 1px solid var(--border-default); border-radius: 4px; font-size: 10px; }
.quick-search-empty { padding: 40px 20px 48px; text-align: center; color: var(--text-tertiary); }
.quick-search-empty p { margin: 16px 0 8px; font-size: 15px; color: var(--text-secondary); }
.quick-search-empty small { font-size: 12px; }
.quick-search-error { padding: 0 22px; font-size: 13px; color: var(--danger); }
@media (max-width: 720px) { .quick-search-mask { padding: max(16px, env(safe-area-inset-top)) 12px; } .quick-search-dialog { max-height: calc(100dvh - 32px); } header { padding: 16px; gap: 10px; } }
</style>
