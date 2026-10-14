<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { childrenOf, descendantsOf, flattenToc } from '../../shared/knowledge-base'
import type { KnowledgeBase, TocNode } from '../../shared/knowledge-base'
import type { LocalNote } from '../../shared/types'
import type { KnowledgeBaseHistory } from '../db/knowledge-base-types'
import { addKnowledgeBaseNode, changeToc, createKnowledgeBase, metadata, moveKnowledgeBaseNode, removeKnowledgeBaseNode, resolveKnowledgeBaseConflict, updateKnowledgeBase } from '../db/knowledge-base-repo'
import { db } from '../db/schema'
import { isMobile, openDrawer, pushNav, showKnowledgeBases } from '../navigation'
import { notify } from '../notify'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import { useNotesStore } from '../stores/notes'
import { useUiStore } from '../stores/ui'
import { retrySyncNow, syncNow } from '../sync/engine'
import { matchesAll, splitTerms } from './SearchBar'
import { useDialogFocus } from './useDialogFocus'
import AppIcon from './AppIcon.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import KnowledgeBaseForm from './KnowledgeBaseForm.vue'

const libraries = useKnowledgeBasesStore()
const notes = useNotesStore()
const ui = useUiStore()
const removed = ref(false)
const book = computed(() => libraries.books.find(b => b.id === ui.activeKnowledgeBaseId))
const nodes = computed(() => libraries.tocs.find(t => t.knowledge_base_id === book.value?.id)?.nodes ?? [])
const books = computed(() => libraries.books.filter(b => b.invalid === Number(removed.value)).sort((a, b) => a.ord - b.ord || b.update_time - a.update_time))
const noteMap = computed(() => new Map(libraries.notes.map(n => [n.id, n])))
const selected = computed(() => nodes.value.find(n => n.id === ui.activeTocNodeId))
const parent = computed(() => selected.value?.kind === 'folder' ? selected.value.id : selected.value?.parent_id ?? null)
const currentTasks = computed(() => libraries.tasks.filter(t => !book.value || t.book_id === book.value.id))
const pending = computed(() => currentTasks.value.some(t => !t.blocked))
const conflicts = computed(() => currentTasks.value.filter(t => t.conflict))
const error = ref('')
const busy = ref(false)
const tree = ref<HTMLElement | null>(null)
const formOpen = ref(false)
const editing = ref<KnowledgeBase | undefined>()
const chapterTitle = ref('')
const dialog = ref<'chapter' | 'add' | 'move' | 'conflict' | 'history' | null>(null)
const historyBookId = ref<string | null>(null)
const historyRows = computed(() => libraries.histories.filter(h => h.book_id === historyBookId.value).sort((a, b) => b.time - a.time))
const panel = ref<HTMLElement | null>(null)
const moving = ref<TocNode | null>(null)
const moveParent = ref('')
const chapterEditing = ref<TocNode | null>(null)
const pickerQuery = ref('')
const candidates = ref<LocalNote[]>([])
const chosen = ref<string[]>([])
const confirm = ref<{ title: string; message: string; run: () => Promise<unknown> } | null>(null)
const dragging = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
useDialogFocus(() => dialog.value !== null, panel, () => { dialog.value = null })

async function run(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await action() } catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false }
}
const rows = computed(() => {
  const flat = flattenToc(nodes.value)
  const terms = splitTerms(ui.query)
  if (terms.length) return flat.filter(({ node }) => {
    const note = node.note_id ? noteMap.value.get(node.note_id) : undefined
    return matchesAll(node.kind === 'folder' ? node.title ?? '' : `${note?.title ?? ''}\n${note?.body ?? ''}`, terms)
  })
  const hidden = new Set<string>()
  for (const id of ui.collapsedKnowledgeBaseNodes) for (const child of descendantsOf(nodes.value, id)) if (child !== id) hidden.add(child)
  return flat.filter(({ node }) => !hidden.has(node.id))
})
const folders = computed(() => flattenToc(nodes.value).filter(({ node }) => node.kind === 'folder' && (!moving.value || !descendantsOf(nodes.value, moving.value.id).has(node.id))))
const picker = computed(() => candidates.value.filter(n => matchesAll(`${n.title}\n${n.body}`, splitTerms(pickerQuery.value))))
const included = computed(() => new Set(nodes.value.flatMap(n => n.note_id ? [n.note_id] : [])))
function label(node: TocNode) {
  if (node.kind === 'folder') return node.title || '未命名章节'
  const note = noteMap.value.get(node.note_id!)
  if (note?.invalid === 1) return `${note.title || '无标题'}（在回收站）`
  if (note?.invalid === 2 || libraries.noteStates.find(n => n.id === node.note_id)?.state === 'purged' && !note) return '笔记已彻底删除'
  return note ? note.title || '无标题' : '笔记尚未同步到本机'
}
function count(id: string) {
  const refs = libraries.tocs.find(t => t.knowledge_base_id === id)?.nodes.flatMap(n => n.note_id ? [n.note_id] : []) ?? []
  return refs.filter(id => noteMap.value.get(id)?.invalid === 0).length
}
function toggle(node: TocNode) {
  const index = ui.collapsedKnowledgeBaseNodes.indexOf(node.id)
  if (index === -1) ui.collapsedKnowledgeBaseNodes.push(node.id)
  else ui.collapsedKnowledgeBaseNodes.splice(index, 1)
}
function open(node: TocNode) {
  if (node.kind === 'folder') { ui.activeTocNodeId = node.id; toggle(node); return }
  const note = noteMap.value.get(node.note_id!)
  if (!note || note.invalid !== 0) { notify(label(node)); return }
  if (isMobile()) pushNav()
  ui.activeTocNodeId = node.id
  notes.open(note.id)
}
function home() { notes.currentId = null; ui.activeTocNodeId = null; ui.mobilePane = 'list' }
function create() { editing.value = undefined; formOpen.value = true }
async function saveForm(meta: ReturnType<typeof metadata>) {
  await run(async () => {
    if (editing.value) await updateKnowledgeBase(editing.value.id, meta)
    else { const created = await createKnowledgeBase({ ...meta, ord: libraries.books.length }); await showKnowledgeBases(created.id) }
    formOpen.value = false
  })
}
function chapter(node?: TocNode) { chapterEditing.value = node ?? null; chapterTitle.value = node?.title ?? ''; dialog.value = 'chapter' }
async function saveChapter() {
  await run(async () => {
    if (!book.value || !chapterTitle.value.trim()) return
    if (chapterEditing.value) await changeToc(book.value.id, nodes => nodes.map(n => n.id === chapterEditing.value!.id ? { ...n, title: chapterTitle.value.trim() } : n))
    else {
      ui.activeTocNodeId = await addKnowledgeBaseNode(book.value.id, { kind: 'folder', title: chapterTitle.value.trim(), note_id: null }, parent.value)
      ui.collapsedKnowledgeBaseNodes = ui.collapsedKnowledgeBaseNodes.filter(id => id !== parent.value)
    }
    dialog.value = null
  })
}
async function add() {
  await run(async () => { candidates.value = (await db.notes.toArray()).filter(n => n.invalid === 0); chosen.value = []; pickerQuery.value = ''; dialog.value = 'add' })
}
async function saveNotes() {
  await run(async () => {
    if (!book.value) return
    const target = parent.value
    await changeToc(book.value.id, nodes => [...nodes, ...chosen.value.filter(id => !nodes.some(n => n.note_id === id)).map((id, i): TocNode => ({
      id: crypto.randomUUID(), kind: 'note', note_id: id, title: null, parent_id: target, ord: childrenOf(nodes, target).length + i,
    }))])
    ui.collapsedKnowledgeBaseNodes = ui.collapsedKnowledgeBaseNodes.filter(id => id !== target)
    dialog.value = null
    await notes.load()
  })
}
function removeNode(node: TocNode) {
  if (!book.value) return
  const id = book.value.id
  confirm.value = { title: `移除${node.kind === 'folder' ? '章节' : '笔记引用'}？`, message: node.kind === 'folder' ? '章节及其子目录会从当前知识库移除，笔记正文仍保留。' : '只移除当前知识库的引用，原笔记仍然保留。',
    run: async () => { await removeKnowledgeBaseNode(id, node.id); await notes.load() } }
}
function removeBook(b: KnowledgeBase) {
  confirm.value = { title: `移除「${b.name}」？`, message: '知识库可以恢复，其中的笔记正文不会删除。', run: async () => { await updateKnowledgeBase(b.id, { invalid: 1 }); await showKnowledgeBases() } }
}
async function confirmAction() { const action = confirm.value; confirm.value = null; if (action) await run(action.run) }
function move(node: TocNode) { moving.value = node; moveParent.value = node.parent_id ?? ''; dialog.value = 'move' }
async function saveMove() {
  await run(async () => {
    if (!book.value || !moving.value) return
    const parent = moveParent.value || null
    await moveKnowledgeBaseNode(book.value.id, moving.value.id, parent, childrenOf(nodes.value, parent).filter(n => n.id !== moving.value!.id).length)
    dialog.value = null
  })
}
async function reorder(node: TocNode, delta: number) {
  if (!book.value) return
  const siblings = childrenOf(nodes.value, node.parent_id)
  const index = siblings.findIndex(n => n.id === node.id) + delta
  if (index < 0 || index >= siblings.length) return
  await run(() => moveKnowledgeBaseNode(book.value!.id, node.id, node.parent_id, index))
}
function dragStart(event: DragEvent, node: TocNode) { dragging.value = node.id; event.dataTransfer?.setData('text/plain', node.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move' }
async function drop(event: DragEvent, target: TocNode | null) {
  event.preventDefault()
  const id = dragging.value
  dragging.value = dropTarget.value = null
  if (!id || !book.value) return
  const parent = target?.kind === 'folder' ? target.id : target?.parent_id ?? null
  const position = target?.kind === 'note' ? childrenOf(nodes.value, parent).filter(n => n.id !== id).findIndex(n => n.id === target.id) : childrenOf(nodes.value, parent).length
  await run(() => moveKnowledgeBaseNode(book.value!.id, id, parent, position))
}
async function resolve(id: string, kind: 'meta' | 'toc', choice: 'local' | 'remote') {
  await run(async () => { await resolveKnowledgeBaseConflict(id, kind, choice); await notes.load(); dialog.value = null; void syncNow() })
}
async function retry() { await retrySyncNow() }
function history(id: string) { historyBookId.value = id; dialog.value = 'history' }
function restoreSnapshot(h: KnowledgeBaseHistory) {
  dialog.value = null
  confirm.value = { title: '重新应用这份快照？', message: '目录及快照中的名称、简介、图标将重新应用并同步。笔记正文和回收站状态不会改变；已有缺失引用保留为占位。', run: async () => {
    await changeToc(h.book_id, () => h.nodes, true)
    if (h.meta) await updateKnowledgeBase(h.book_id, { name: h.meta.name, description: h.meta.description, icon: h.meta.icon })
    await notes.load()
  } }
}
let subscription: ReturnType<typeof libraries.subscribe> | undefined
onMounted(() => { subscription = libraries.subscribe(); void notes.load() })
onUnmounted(() => subscription?.unsubscribe())
watch(() => ui.activeKnowledgeBaseId, () => { error.value = ''; dialog.value = null; void notes.load() })
watch(() => ui.restorePosition, async position => { if (position?.view === 'knowledge-bases') { await nextTick(); if (tree.value) tree.value.scrollTop = position.knowledgeBaseScroll ?? 0 } })
</script>

<template>
  <div class="knowledge-base-workspace">
    <header class="kb-header">
      <button class="icon-button drawer-btn" aria-label="打开侧栏" @click="openDrawer"><AppIcon name="menu" /></button>
      <button v-if="book" class="icon-button" aria-label="返回知识库列表" @click="showKnowledgeBases()"><AppIcon name="back" /></button>
      <h2>{{ book ? book.name : '知识库' }}</h2>
      <button v-if="!book" class="dialog-btn ok kb-create" @click="create"><AppIcon name="plus" :size="15" />新建</button>
    </header>
    <p v-if="error || libraries.error" class="kb-error" role="alert">{{ error || libraries.error }}</p>
    <div v-if="ui.knowledgeBaseSyncError" class="kb-sync-warning" role="status">{{ ui.knowledgeBaseSyncError }} <button @click="retry">重试</button></div>
    <div v-if="conflicts.length" class="kb-sync-warning" role="status">知识库有同步冲突，两份修改已保留。<button @click="dialog = 'conflict'">查看并选择</button></div>
    <template v-if="!book">
      <div class="kb-list-intro"><h1>把笔记整理成知识</h1><p>按专题建立目录，让相关笔记连在一起。</p></div>
      <div class="kb-tabs"><button :class="{ active: !removed }" @click="removed = false">我的知识库</button><button :class="{ active: removed }" @click="removed = true">已移除</button></div>
      <div class="kb-card-grid">
        <article v-for="b in books" :key="b.id" class="kb-card" :data-book-id="b.id">
          <button class="kb-card-link" :disabled="!!b.invalid" @click="showKnowledgeBases(b.id)"><span class="kb-card-icon" aria-hidden="true">{{ b.icon || '📚' }}</span><h3>{{ b.name }}</h3><p>{{ b.description || '还没有简介' }}</p><small>{{ count(b.id) }} 篇笔记</small></button>
          <div class="kb-card-actions"><button v-if="b.invalid" @click="run(() => updateKnowledgeBase(b.id, { invalid: 0 }))">恢复知识库</button><template v-else><button @click="editing = b; formOpen = true">编辑</button><button @click="removeBook(b)">移除</button></template><button v-if="libraries.histories.some(h => h.book_id === b.id && h.source === 'conflict')" @click="history(b.id)">保留的快照</button><span v-if="libraries.tasks.some(t => t.book_id === b.id)">{{ libraries.tasks.some(t => t.book_id === b.id && t.blocked) ? '有冲突' : '待同步' }}</span></div>
        </article>
        <button v-if="!removed" class="kb-card kb-new-card" @click="create"><AppIcon name="plus" :size="28" /><span>新建知识库</span></button>
      </div>
      <p v-if="removed && !books.length" class="kb-empty">没有已移除的知识库</p>
    </template>
    <template v-else-if="!book.invalid">
      <div class="kb-mobile-overview"><span aria-hidden="true">{{ book.icon || '📚' }}</span><p>{{ book.description || '把相关笔记按章节整理在一起。' }}</p><small>{{ count(book.id) }} 篇笔记</small></div>
      <div class="kb-toolbar"><button @click="home"><AppIcon name="notes" :size="15" /> 首页</button><button aria-label="目录快照" title="目录快照" @click="history(book.id)"><AppIcon name="clock" :size="15" /></button><button aria-label="编辑知识库" title="编辑知识库" @click="editing = book; formOpen = true"><AppIcon name="edit" :size="15" /></button><button aria-label="移除知识库" title="移除知识库" @click="removeBook(book)"><AppIcon name="trash" :size="15" /></button></div>
      <label class="kb-search"><AppIcon name="search" :size="16" /><input v-model="ui.query" placeholder="搜索本库笔记" aria-label="搜索本库笔记" /><button v-if="ui.query" class="icon-button" aria-label="清除知识库搜索" @click="ui.query = ''"><AppIcon name="close" :size="14" /></button></label>
      <p v-if="ui.query" class="kb-search-hint">搜索标题与已下载正文 · {{ rows.length }} 个结果</p>
      <div class="kb-create-actions"><button @click="notes.create()">新建笔记</button><button @click="add">加入笔记</button><button @click="chapter()">新建章节</button></div>
      <p v-if="parent" class="kb-search-hint">新内容将加入「{{ nodes.find(n => n.id === parent)?.title }}」<button @click="ui.activeTocNodeId = null">改为根目录</button></p>
      <div ref="tree" class="knowledge-base-tree" aria-label="知识库目录">
        <div v-for="{ node, depth, path } in rows" :key="node.id" class="kb-tree-row" :class="{ selected: ui.activeTocNodeId === node.id, 'drop-target': dropTarget === node.id }" :style="{ paddingLeft: `${Math.min(depth, 5) * 14 + 8}px` }" :data-node-id="node.id" draggable="true" @dragstart="dragStart($event, node)" @dragend="dragging = dropTarget = null" @dragover.prevent="dropTarget = node.id" @dragleave="dropTarget = null" @drop.stop="drop($event, node)">
          <button class="kb-node-link" :aria-current="ui.activeTocNodeId === node.id ? 'true' : undefined" :aria-expanded="node.kind === 'folder' ? !ui.collapsedKnowledgeBaseNodes.includes(node.id) : undefined" :title="label(node)" @click="open(node)"><AppIcon :name="node.kind === 'folder' ? 'chevron' : 'note'" :size="15" :class="{ expanded: node.kind === 'folder' && !ui.collapsedKnowledgeBaseNodes.includes(node.id) }" /><span>{{ label(node) }}<small v-if="ui.query && path.length">{{ path.join(' / ') }}</small></span></button>
          <details class="kb-node-menu"><summary :aria-label="`目录操作：${label(node)}`"><AppIcon name="more" :size="16" /></summary><div class="kb-node-actions"><button v-if="node.kind === 'folder'" @click="chapter(node)">重命名</button><button @click="reorder(node, -1)">上移</button><button @click="reorder(node, 1)">下移</button><button @click="move(node)">移动到…</button><button @click="removeNode(node)">移除引用</button></div></details>
        </div>
        <div class="kb-root-drop" @dragover.prevent="dropTarget = 'root'" @drop="drop($event, null)">{{ dragging ? '放到这里移至根目录末尾' : nodes.length ? '' : '目录还是空的，加入笔记或新建章节。' }}</div>
        <p v-if="ui.query && !rows.length" class="kb-empty">没有匹配的目录或已下载笔记</p>
      </div>
      <footer class="kb-directory-footer">{{ nodes.filter(n => n.kind === 'note').length }} 篇引用 · {{ pending ? '本地已保存，待同步' : '已同步' }}<button @click="retry" :disabled="ui.syncing">同步</button></footer>
    </template>
    <p v-else class="kb-empty">知识库已移除。<button @click="run(() => updateKnowledgeBase(book!.id, { invalid: 0 }))">恢复</button></p>
    <KnowledgeBaseForm :error="error" :open="formOpen" :initial="editing ? metadata(editing) : undefined" @save="saveForm" @close="formOpen = false" />
    <Teleport to="body">
      <ConfirmDialog :open="!!confirm" :title="confirm?.title ?? ''" :message="confirm?.message" :confirm-text="confirm?.title.includes('快照') ? '重新应用' : '移除'" @confirm="confirmAction" @cancel="confirm = null" />
      <div v-if="dialog" class="dialog-mask" @click.self="dialog = null">
        <div ref="panel" class="dialog kb-workspace-dialog" role="dialog" aria-modal="true" :aria-label="dialog === 'chapter' ? '章节名称' : dialog === 'add' ? '加入已有笔记' : dialog === 'move' ? '移动目录' : '解决知识库冲突'">
          <template v-if="dialog === 'chapter'"><h3 class="dialog-title">{{ chapterEditing ? '重命名章节' : '新建章节' }}</h3><input v-model="chapterTitle" class="dialog-input" aria-label="章节名称" maxlength="100" @keydown.enter="!$event.isComposing && saveChapter()" /><div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">取消</button><button class="dialog-btn ok" :disabled="!chapterTitle.trim()" @click="saveChapter">保存</button></div></template>
          <template v-else-if="dialog === 'add'"><h3 class="dialog-title">加入已有笔记</h3><input v-model="pickerQuery" class="dialog-input" placeholder="搜索已有笔记" aria-label="搜索已有笔记" /><div class="kb-picker"><label v-for="note in picker" :key="note.id"><input v-model="chosen" type="checkbox" :value="note.id" :disabled="included.has(note.id)" /><span>{{ note.title || '无标题' }}</span><small v-if="included.has(note.id)">已加入</small></label><p v-if="!picker.length">没有可加入的笔记</p></div><div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">取消</button><button class="dialog-btn ok" :disabled="!chosen.length" @click="saveNotes">加入 {{ chosen.length }} 篇</button></div></template>
          <template v-else-if="dialog === 'move'"><h3 class="dialog-title">移动「{{ moving ? label(moving) : '' }}」</h3><label>目标章节<select v-model="moveParent" class="dialog-input" aria-label="目标章节"><option value="">根目录</option><option v-for="{ node, path } in folders" :key="node.id" :value="node.id">{{ [...path, node.title].join(' / ') }}</option></select></label><p>移动后放在目标章节的末尾。</p><div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">取消</button><button class="dialog-btn ok" @click="saveMove">移动</button></div></template>
          <template v-else-if="dialog === 'history'"><h3 class="dialog-title">本机保留的目录快照</h3><p>这些快照保存在本机，完整备份会包含它们。恢复快照不会恢复或删除笔记正文。</p><p v-if="!historyRows.length">暂无快照</p><details v-for="h in historyRows" :key="h.id" class="kb-conflict"><summary>{{ new Date(h.time).toLocaleString() }} · {{ h.source === 'conflict' ? '冲突 / 导入保留' : h.source === 'discarded' ? '选择前保留' : '已确认目录' }} · {{ h.nodes.length }} 个节点</summary><p v-if="h.meta">{{ h.meta.name }} · {{ h.meta.description }}</p><ol><li v-for="{ node, depth } in flattenToc(h.nodes)" :key="node.id" :style="{ marginLeft: `${depth * 12}px` }">{{ label(node) }}</li></ol><button class="dialog-btn ok" :disabled="libraries.books.find(b => b.id === h.book_id)?.invalid === 1 || libraries.tasks.some(t => t.book_id === h.book_id && t.blocked)" @click="restoreSnapshot(h)">重新应用快照</button></details><div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">关闭</button></div></template>
          <template v-else><h3 class="dialog-title">解决知识库冲突</h3><p>请选择要保留的版本。两份内容均已保存为本机快照。</p><article v-for="conflict in conflicts" :key="conflict.id" class="kb-conflict"><h4>{{ libraries.books.find(b => b.id === conflict.book_id)?.name }} · {{ conflict.kind === 'toc' ? '目录' : '库信息与移除状态' }}</h4><div class="kb-conflict-versions"><div><b>本机修改</b><p v-if="conflict.kind === 'meta'">{{ libraries.books.find(b => b.id === conflict.book_id)?.name }}<br />{{ libraries.books.find(b => b.id === conflict.book_id)?.description }}<br />{{ libraries.books.find(b => b.id === conflict.book_id)?.invalid ? '已移除' : '正常使用' }}</p><ol v-else><li v-for="{ node, depth } in flattenToc(libraries.tocs.find(t => t.knowledge_base_id === conflict.book_id)?.nodes ?? [])" :key="node.id" :style="{ marginLeft: `${depth * 12}px` }">{{ label(node) }}</li></ol><button class="dialog-btn ok" @click="resolve(conflict.book_id, conflict.kind, 'local')">保留本机修改</button></div><div><b>另一台设备</b><p v-if="conflict.kind === 'meta'">{{ conflict.conflict?.book.name }}<br />{{ conflict.conflict?.book.description }}<br />{{ conflict.conflict?.book.invalid ? '已移除' : '正常使用' }}</p><ol v-else><li v-for="{ node, depth } in flattenToc(conflict.conflict?.toc.nodes ?? [])" :key="node.id" :style="{ marginLeft: `${depth * 12}px` }">{{ label(node) }}</li></ol><p v-if="conflict.conflict?.book.invalid">知识库已移除；保留本机目录会恢复知识库。</p><button class="dialog-btn cancel" @click="resolve(conflict.book_id, conflict.kind, 'remote')">接受另一台设备</button></div></div></article><div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">稍后处理</button></div></template>
          <p v-if="error" class="kb-error" role="alert">{{ error }}</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="./knowledge-base.css"></style>
