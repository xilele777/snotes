<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { childrenOf, descendantsOf, flattenToc } from '../../shared/knowledge-base'
import type { KnowledgeBase, TocNode } from '../../shared/knowledge-base'
import type { LocalNote } from '../../shared/types'
import { addKnowledgeBaseNode, changeToc, createKnowledgeBase, deleteKnowledgeBase, metadata, moveKnowledgeBaseNode, trashKnowledgeBaseNode, resolveKnowledgeBaseConflict, updateKnowledgeBase } from '../db/knowledge-base-repo'
import { db } from '../db/schema'
import { notebookOwnedNoteIds } from '../db/repo'
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
import DeleteNotebookDialog from './DeleteNotebookDialog.vue'
import KnowledgeBaseForm from './KnowledgeBaseForm.vue'
import ActionMenu from './ActionMenu.vue'
import SortMenu from './SortMenu.vue'
import KnowledgeBaseHome from './KnowledgeBaseHome.vue'
import { workspacePreferences as preferences, updateWorkspacePreferences, togglePinnedKnowledgeBase, type LibrarySort } from '../workspace-preferences'

const libraries = useKnowledgeBasesStore()
const notes = useNotesStore()
const ui = useUiStore()
const book = computed(() => libraries.books.find(b => b.id === ui.activeKnowledgeBaseId))
const nodes = computed(() => libraries.tocs.find(t => t.knowledge_base_id === book.value?.id)?.nodes ?? [])
const books = computed(() => libraries.books.filter(b => !b.invalid && matchesAll(`${b.name}\n${b.description}`, splitTerms(ui.query))).sort((a, b) => Number(preferences.value.pinnedKnowledgeBaseIds.includes(b.id)) - Number(preferences.value.pinnedKnowledgeBaseIds.includes(a.id)) || (preferences.value.librarySort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.update_time - a.update_time) || a.id.localeCompare(b.id)))
const noteMap = computed(() => new Map(libraries.notes.map(n => [n.id, n])))
const createParent = ref('')
const creationFolders = computed(() => flattenToc(nodes.value).filter(({ node }) => node.kind === 'folder'))
const currentTasks = computed(() => libraries.tasks.filter(t => !book.value || t.book_id === book.value.id))
const conflicts = computed(() => currentTasks.value.filter(t => t.conflict))
const error = ref('')
const busy = ref(false)
const tree = ref<HTMLElement | null>(null)
const formOpen = ref(false)
const editing = ref<KnowledgeBase | undefined>()
const chapterTitle = ref('')
const dialog = ref<'chapter' | 'add' | 'move' | 'conflict' | null>(null)
const panel = ref<HTMLElement | null>(null)
const moving = ref<TocNode | null>(null)
const moveParent = ref('')
const chapterEditing = ref<TocNode | null>(null)
const pickerQuery = ref('')
const candidates = ref<LocalNote[]>([])
const chosen = ref<string[]>([])
const confirm = ref<{ title: string; message: string; run: () => Promise<unknown> } | null>(null)
const deleting = ref<{ id: string; name: string; nodes: TocNode[] } | null>(null)
const deletionError = ref('')
const deletionBusy = ref(false)
const dragging = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropZone = ref<'before' | 'after' | 'inside'>('inside')
const menu = ref<{ kind: 'book' | 'node' | 'create' | 'tree'; anchor: HTMLElement; book?: KnowledgeBase; node?: TocNode } | null>(null)
function openMenu(event: MouseEvent, kind: 'book' | 'node' | 'create' | 'tree', item?: KnowledgeBase | TocNode) {
  const anchor = event.currentTarget as HTMLElement
  if (menu.value?.anchor === anchor) { menu.value = null; return }
  menu.value = { kind, anchor, book: kind === 'book' ? item as KnowledgeBase : undefined, node: kind === 'node' ? item as TocNode : undefined }
}
async function menuAction(action: 'edit' | 'remove-book' | 'pin' | 'new-note' | 'add' | 'chapter' | 'expand' | 'collapse' | 'rename' | 'up' | 'down' | 'move' | 'detach' | 'remove-node') {
  const current = menu.value
  menu.value = null
  await nextTick()
  const target = current?.node?.kind === 'folder' ? current.node.id : null
  if (action === 'new-note') return run(() => notes.create({ knowledgeBaseParentId: target }))
  if (action === 'add') return add(target)
  if (action === 'chapter') return chapter(undefined, target)
  if (action === 'expand' || action === 'collapse') {
    const ids = new Set(nodes.value.map(n => n.id))
    ui.collapsedKnowledgeBaseNodes = ui.collapsedKnowledgeBaseNodes.filter(id => !ids.has(id))
    if (action === 'collapse') ui.collapsedKnowledgeBaseNodes.push(...nodes.value.filter(n => n.kind === 'folder').map(n => n.id))
  }
  if (current?.book) {
    if (action === 'edit') { editing.value = current.book; formOpen.value = true }
    if (action === 'remove-book') removeBook(current.book)
    if (action === 'pin') togglePinnedKnowledgeBase(current.book.id)
  }
  if (current?.node) {
    if (action === 'rename') chapter(current.node)
    if (action === 'up') return reorder(current.node, -1)
    if (action === 'down') return reorder(current.node, 1)
    if (action === 'move') move(current.node)
    if (action === 'detach' && current.node.note_id) {
      const noteId = current.node.note_id
      return run(async () => {
        for (const toc of libraries.tocs.filter(t => t.nodes.some(n => n.note_id === noteId))) await changeToc(toc.knowledge_base_id, nodes => nodes.filter(n => n.note_id !== noteId))
        await notes.load()
        notify('已移出笔记本，可在普通笔记列表中找到')
      })
    }
    if (action === 'remove-node') removeNode(current.node)
  }
}
const menuSiblings = computed(() => menu.value?.node ? childrenOf(nodes.value, menu.value.node.parent_id) : [])
const menuNodeIndex = computed(() => menuSiblings.value.findIndex(n => n.id === menu.value?.node?.id))
function onTreeKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || !(event.target as HTMLElement).matches('.kb-node-link')) return
  const links = [...(tree.value?.querySelectorAll<HTMLButtonElement>('.kb-node-link') ?? [])]
  const index = links.indexOf(event.target as HTMLButtonElement)
  let next: number
  if (event.key === 'ArrowDown') next = Math.min(index + 1, links.length - 1)
  else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0)
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = links.length - 1
  else return
  event.preventDefault()
  links[next]?.focus()
}
useDialogFocus(() => dialog.value !== null, panel, () => { dialog.value = null })

async function run(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await action() } catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false }
}
const visibleNodes = computed(() => {
  // Keep recovery placement in storage. Confirmed deletions must not turn back
  // into visible placeholders when purging removes the local note row.
  const states = new Map(libraries.noteStates.map(n => [n.id, n.state]))
  const hidden = new Set(nodes.value.filter(n => {
    if (!n.note_id) return false
    const note = noteMap.value.get(n.note_id)
    return note ? note.invalid !== 0 : ['trash', 'purged'].includes(states.get(n.note_id) ?? '')
  }).map(n => n.id))
  for (const folder of nodes.value.filter(n => n.kind === 'folder')) {
    const subtree = descendantsOf(nodes.value, folder.id)
    const refs = nodes.value.filter(n => subtree.has(n.id) && n.kind === 'note')
    if (refs.length && refs.every(n => hidden.has(n.id))) for (const id of subtree) hidden.add(id)
  }
  return nodes.value.filter(n => !hidden.has(n.id))
})
const rows = computed(() => {
  const flat = flattenToc(visibleNodes.value)
  const terms = splitTerms(ui.query)
  if (terms.length) return flat.filter(({ node }) => {
    const note = node.note_id ? noteMap.value.get(node.note_id) : undefined
    return matchesAll(node.kind === 'folder' ? node.title ?? '' : `${note?.title ?? ''}\n${libraries.bodyText.get(node.note_id!) ?? ''}`, terms)
  })
  const hidden = new Set<string>()
  for (const id of ui.collapsedKnowledgeBaseNodes) for (const child of descendantsOf(nodes.value, id)) if (child !== id) hidden.add(child)
  return flat.filter(({ node }) => !hidden.has(node.id))
})
const folders = computed(() => flattenToc(nodes.value).filter(({ node }) => node.kind === 'folder' && (!moving.value || !descendantsOf(nodes.value, moving.value.id).has(node.id))))
const picker = computed(() => candidates.value.filter(n => matchesAll(`${n.title}\n${libraries.bodyText.get(n.id) ?? ''}`, splitTerms(pickerQuery.value))))
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
function chapter(node?: TocNode, target: string | null = null) { chapterEditing.value = node ?? null; chapterTitle.value = node?.title ?? ''; createParent.value = target ?? ''; dialog.value = 'chapter' }
async function saveChapter() {
  await run(async () => {
    if (!book.value || !chapterTitle.value.trim()) return
    if (chapterEditing.value) await changeToc(book.value.id, nodes => nodes.map(n => n.id === chapterEditing.value!.id ? { ...n, title: chapterTitle.value.trim() } : n))
    else {
      const target = createParent.value || null
      ui.activeTocNodeId = await addKnowledgeBaseNode(book.value.id, { kind: 'folder', title: chapterTitle.value.trim(), note_id: null }, target)
      ui.collapsedKnowledgeBaseNodes = ui.collapsedKnowledgeBaseNodes.filter(id => id !== target)
    }
    dialog.value = null
  })
}
async function add(target: string | null = null) {
  // 一条笔记只属于一本笔记本：已经在别人家的笔记不再出现在候选里。
  await run(async () => {
    const owned = await notebookOwnedNoteIds()
    const rows = (await db.notes.toArray()).filter(n => n.invalid === 0 && !owned.has(n.id))
    candidates.value = rows
    // 候选笔记的正文只在这一刻取一次：选择器里要按正文搜索
    const bodies = await db.bodies.bulkGet(rows.map(n => n.id))
    const picked = new Map(bodies.filter((row): row is NonNullable<typeof row> => !!row).map(row => [row.id, row.body]))
    for (const [id, text] of picked) libraries.bodyText.set(id, text)
    chosen.value = []; pickerQuery.value = ''; createParent.value = target ?? ''; dialog.value = 'add'
  })
}
async function saveNotes() {
  await run(async () => {
    if (!book.value) return
    const target = createParent.value || null
    await changeToc(book.value.id, nodes => [...nodes, ...chosen.value.filter(id => !nodes.some(n => n.note_id === id)).map((id, i): TocNode => ({
      id: crypto.randomUUID(), kind: 'note', note_id: id, title: null, parent_id: target, ord: childrenOf(nodes, target).length + i,
    }))])
    ui.collapsedKnowledgeBaseNodes = ui.collapsedKnowledgeBaseNodes.filter(id => id !== target)
    dialog.value = null
    await notes.load()
  })
}
/**
 * 「从本笔记本移除」= 删除。笔记独属于笔记本，一旦不再属于它就等于从系统里消失，
 * 所以直接把正文丢进回收站（可恢复），而不是只摘掉目录节点、留下一条孤儿笔记。
 * 章节要连子目录里的笔记一起丢；留在目录里的笔记由目录状态标成「在回收站」，可原样恢复。
 */
function removeNode(node: TocNode) {
  if (!book.value) return
  if (node.kind === 'note' && node.note_id) { void notes.trashWithUndo(node.note_id); return }
  const id = book.value.id
  const expectedNodes: TocNode[] = JSON.parse(JSON.stringify(nodes.value))
  const removed = descendantsOf(expectedNodes, node.id)
  const noteIds = [...new Set(expectedNodes.filter(n => removed.has(n.id) && n.note_id).map(n => n.note_id!))]
  confirm.value = {
    title: node.kind === 'folder' ? '删除这个章节？' : '从本笔记本删除这条笔记？',
    message: node.kind === 'folder'
      ? `章节、子目录及其中的 ${noteIds.length} 篇笔记会一起移入回收站，之后可以恢复。`
      : '笔记只属于这本笔记本，删除后会移入回收站，可在回收站恢复。',
    run: async () => {
      await trashKnowledgeBaseNode(id, node.id, expectedNodes)
      await notes.load()
    },
  }
}
function removeBook(b: KnowledgeBase) {
  deletionError.value = ''
  deleting.value = { id: b.id, name: b.name, nodes: JSON.parse(JSON.stringify(libraries.tocs.find(t => t.knowledge_base_id === b.id)?.nodes ?? [])) }
}
async function confirmDelete() {
  if (!deleting.value || deletionBusy.value) return
  deletionBusy.value = true
  deletionError.value = ''
  const target = deleting.value
  try {
    if (!navigator.onLine) throw new Error('请连接网络后重试删除')
    await retrySyncNow()
    const latest = await db.knowledgeBases.get(target.id)
    const toc = await db.knowledgeBaseTocs.get(target.id)
    if (!latest?.deleted && (latest?.name !== target.name || JSON.stringify(toc?.nodes ?? []) !== JSON.stringify(target.nodes))) {
      throw new Error('笔记本内容已更新，请取消后重新确认删除')
    }
    await deleteKnowledgeBase(target.id, target.name)
    notes.currentId = null
    deleting.value = null
    await showKnowledgeBases()
    await notes.load()
    notify('笔记本及其中的内容已永久删除')
    await nextTick()
    document.querySelector<HTMLElement>('.kb-header h2')?.focus()
  } catch (e) { deletionError.value = e instanceof Error ? e.message : String(e) }
  finally { deletionBusy.value = false }
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
function dragOver(event: DragEvent, node: TocNode) {
  event.preventDefault()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / rect.height
  dropTarget.value = node.id
  dropZone.value = ratio < .25 ? 'before' : ratio > .75 ? 'after' : node.kind === 'folder' ? 'inside' : ratio < .5 ? 'before' : 'after'
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function dragLeave(event: DragEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) dropTarget.value = null
}
async function drop(event: DragEvent, target: TocNode | null) {
  event.preventDefault()
  const id = dragging.value
  const zone = dropZone.value
  dragging.value = dropTarget.value = null
  if (!id || !book.value || id === target?.id) return
  const inside = target?.kind === 'folder' && zone === 'inside'
  const parent = inside ? target.id : target?.parent_id ?? null
  if (parent && descendantsOf(nodes.value, id).has(parent)) return
  const siblings = childrenOf(nodes.value, parent).filter(n => n.id !== id)
  const position = !target || inside ? siblings.length : siblings.findIndex(n => n.id === target.id) + (zone === 'after' ? 1 : 0)
  await run(() => moveKnowledgeBaseNode(book.value!.id, id, parent, position))
}
async function resolve(id: string, kind: 'meta' | 'toc', choice: 'local' | 'remote') {
  await run(async () => { await resolveKnowledgeBaseConflict(id, kind, choice); await notes.load(); dialog.value = null; void syncNow() })
}
let subscription: ReturnType<typeof libraries.subscribe> | undefined
onMounted(() => { subscription = libraries.subscribe(); void notes.load() })
onUnmounted(() => subscription?.unsubscribe())
watch(() => ui.activeKnowledgeBaseId, () => { error.value = ''; dialog.value = null; menu.value = null; void notes.load() })
watch(() => book.value?.deleted, deleted => { if (deleted) void showKnowledgeBases() })
watch(() => ui.restorePosition, async position => { if (position?.view === 'knowledge-bases') { await nextTick(); if (tree.value) tree.value.scrollTop = position.knowledgeBaseScroll ?? 0 } })
</script>

<template>
  <div class="knowledge-base-workspace" :class="{ 'has-book': !!book }">
    <header class="kb-header" :class="{ 'kb-book-header': !!book }">
      <template v-if="book">
        <div class="kb-book-heading">
          <button class="icon-button drawer-btn" aria-label="打开侧栏" @click="openDrawer"><AppIcon name="menu" /></button>
          <button class="kb-book-icon icon-button" aria-label="返回笔记本列表" title="返回笔记本合集" @click="showKnowledgeBases()"><AppIcon name="home" :size="20" /></button>
          <h2 tabindex="-1" :title="book.name">{{ book.name }}</h2>
          <button v-if="!book.invalid" class="icon-button kb-book-menu" aria-label="笔记本操作" title="笔记本操作" aria-haspopup="menu" :aria-expanded="menu?.kind === 'book'" @click="openMenu($event, 'book', book)"><AppIcon name="more" :size="19" /></button>
        </div>
      </template>
      <template v-else>
        <button class="icon-button drawer-btn" aria-label="打开侧栏" @click="openDrawer"><AppIcon name="menu" /></button>
        <h2 tabindex="-1">笔记本</h2>
        <button class="dialog-btn ok kb-create" aria-label="新建笔记本" @click="create"><AppIcon name="plus" :size="15" />新建</button>
      </template>
    </header>
    <p v-if="error || libraries.error" class="kb-error" role="alert">{{ error || libraries.error }}</p>
    <div v-if="conflicts.length" class="kb-sync-warning" role="status">笔记本有同步冲突，两份修改已保留。<button @click="dialog = 'conflict'">查看并选择</button></div>
    <template v-if="!book">
      <div class="kb-overview-tools">
        <label class="kb-search"><AppIcon name="search" :size="16" /><input v-model="ui.query" type="search" aria-label="搜索笔记本" placeholder="搜索笔记本名称或简介" /><button v-if="ui.query" class="search-clear" aria-label="清除笔记本搜索" @click="ui.query = ''"><AppIcon name="close" :size="14" /></button></label>
        <SortMenu label="笔记本排序" :model-value="preferences.librarySort" :options="[{ value: 'updated', label: '最近更新' }, { value: 'name', label: '名称顺序' }]" @update:model-value="updateWorkspacePreferences({ librarySort: $event as LibrarySort })" />
      </div>
      <div class="kb-card-grid">
        <article v-for="b in books" :key="b.id" class="kb-card" :data-book-id="b.id">
          <button class="kb-card-link" :disabled="!!b.invalid" @click="showKnowledgeBases(b.id)">
            <span class="kb-card-heading"><span class="kb-card-icon" aria-hidden="true"><AppIcon v-if="!b.icon || b.icon === '📚'" name="book" :size="23" /><span v-else>{{ b.icon }}</span></span><h3>{{ b.name }}</h3></span>
            <p v-if="b.description">{{ b.description }}</p>
            <span class="kb-card-meta"><span>{{ count(b.id) }} 篇笔记</span><span aria-hidden="true">·</span><span class="kb-card-updated">{{ new Date(b.update_time).toLocaleDateString('zh-CN') }} 更新</span></span>
          </button>
          <button v-if="!b.invalid" class="icon-button kb-card-menu" :aria-label="`笔记本「${b.name}」操作`" aria-haspopup="menu" :aria-expanded="menu?.book?.id === b.id" @click="openMenu($event, 'book', b)"><AppIcon name="more" :size="18" /></button>
        </article>
        <button v-if="!ui.query && !books.length" class="kb-card kb-new-card" @click="create"><AppIcon name="plus" :size="24" /><span>创建第一本笔记本</span></button>
      </div>
      <div v-if="ui.query && !books.length" class="kb-empty"><p>没有找到匹配的笔记本</p><button class="dialog-btn cancel" @click="ui.query = ''">清除搜索</button></div>
    </template>
    <template v-else-if="!book.invalid">
      <div class="kb-mobile-overview"><KnowledgeBaseHome embedded /></div>
      <div class="kb-search-create">
        <label class="kb-search"><AppIcon name="search" :size="18" /><input v-model="ui.query" placeholder="搜索" aria-label="搜索本笔记本中的笔记" /><button v-if="ui.query" class="icon-button" aria-label="清除笔记本搜索" @click="ui.query = ''"><AppIcon name="close" :size="14" /></button></label>
      </div>
      <button class="kb-home-link" :class="{ active: !notes.currentId && !ui.activeTocNodeId }" :aria-current="!notes.currentId && !ui.activeTocNodeId ? 'page' : undefined" @click="home"><AppIcon name="home" :size="17" />首页</button>
      <div class="kb-directory-heading"><AppIcon name="listPanel" :size="17" /><span>目录</span><button class="icon-button" title="更多新建方式" aria-label="更多新建方式" aria-haspopup="menu" :aria-expanded="menu?.kind === 'create'" @click="openMenu($event, 'create')"><AppIcon name="plus" :size="17" /></button><button class="icon-button" aria-label="目录选项" title="展开或收起目录" aria-haspopup="menu" :aria-expanded="menu?.kind === 'tree'" @click="openMenu($event, 'tree')"><AppIcon name="sort" :size="18" /></button></div>
      <p v-if="ui.query" class="kb-search-hint">搜索标题与已下载正文 · {{ rows.length }} 个结果</p>
      <div ref="tree" class="knowledge-base-tree" aria-label="笔记本目录" @keydown="onTreeKeydown">
        <div v-for="{ node, depth, path } in rows" :key="node.id" class="kb-tree-row" :class="{ selected: ui.activeTocNodeId === node.id, 'drop-inside': dropTarget === node.id && dropZone === 'inside', 'drop-before': dropTarget === node.id && dropZone === 'before', 'drop-after': dropTarget === node.id && dropZone === 'after' }" :style="{ paddingLeft: `${Math.min(depth, 5) * 14 + 8}px` }" :data-node-id="node.id" draggable="true" @dragstart="dragStart($event, node)" @dragend="dragging = dropTarget = null" @dragover="dragOver($event, node)" @dragleave="dragLeave" @drop.stop="drop($event, node)">
          <button class="kb-node-link" :aria-current="ui.activeTocNodeId === node.id ? 'true' : undefined" :aria-expanded="node.kind === 'folder' ? !ui.collapsedKnowledgeBaseNodes.includes(node.id) : undefined" :title="label(node)" @click="open(node)"><AppIcon :name="node.kind === 'folder' ? 'chevron' : 'note'" :size="15" :class="{ expanded: node.kind === 'folder' && !ui.collapsedKnowledgeBaseNodes.includes(node.id) }" /><span>{{ label(node) }}<small v-if="ui.query && path.length">{{ path.join(' / ') }}</small></span></button>
          <button class="kb-node-menu icon-button" :aria-label="`目录操作：${label(node)}`" aria-haspopup="menu" :aria-expanded="menu?.node?.id === node.id" @click="openMenu($event, 'node', node)"><AppIcon name="more" :size="16" /></button>
        </div>
        <div class="kb-root-drop" @dragover.prevent="dropTarget = 'root'" @drop="drop($event, null)">{{ dragging ? '放到这里移至根目录末尾' : visibleNodes.length ? '' : '目录还是空的，加入笔记或新建章节。' }}</div>
        <p v-if="ui.query && !rows.length" class="kb-empty">没有匹配的目录或已下载笔记</p>
      </div>
      <footer class="kb-directory-footer">{{ count(book.id) }} 篇笔记</footer>
    </template>
    <p v-else class="kb-empty">笔记本不可用。<button @click="showKnowledgeBases()">返回笔记本列表</button></p>
    <KnowledgeBaseForm :error="error" :busy="busy" :open="formOpen" :initial="editing ? metadata(editing) : undefined" @save="saveForm" @close="formOpen = false" />
    <ActionMenu :open="!!menu" :anchor="menu?.anchor ?? null" :label="menu?.kind === 'book' ? '笔记本操作' : menu?.kind === 'create' ? '添加内容' : '目录操作'" menu-class="knowledge-base-menu" @close="menu = null">
      <template v-if="menu?.kind === 'book'">
        <button class="menu-item" role="menuitem" @click="menuAction('edit')"><AppIcon name="edit" :size="15" />编辑笔记本</button>
        <button class="menu-item" role="menuitemcheckbox" :aria-checked="preferences.pinnedKnowledgeBaseIds.includes(menu.book!.id)" @click="menuAction('pin')"><AppIcon name="pin" :size="15" />{{ preferences.pinnedKnowledgeBaseIds.includes(menu.book!.id) ? '取消固定' : '固定到前面' }}</button>
        <span class="menu-separator" aria-hidden="true"></span>
        <button class="menu-item danger" role="menuitem" @click="menuAction('remove-book')"><AppIcon name="trash" :size="15" />删除笔记本</button>
      </template>
      <template v-else-if="menu?.kind === 'create'">
        <button class="menu-item" role="menuitem" :disabled="busy" @click="menuAction('new-note')"><AppIcon name="plus" :size="15" />新建笔记</button>
        <button class="menu-item" role="menuitem" @click="menuAction('add')"><AppIcon name="notes" :size="15" />加入笔记</button>
        <button class="menu-item" role="menuitem" @click="menuAction('chapter')"><AppIcon name="folder" :size="15" />新建章节</button>
      </template>
      <template v-else-if="menu?.kind === 'tree'">
        <button class="menu-item" role="menuitem" @click="menuAction('expand')">展开全部章节</button>
        <button class="menu-item" role="menuitem" @click="menuAction('collapse')">收起全部章节</button>
      </template>
      <template v-else-if="menu?.node">
        <template v-if="menu.node.kind === 'folder'">
          <button class="menu-item" role="menuitem" @click="menuAction('new-note')"><AppIcon name="plus" :size="15" />在此新建笔记</button>
          <button class="menu-item" role="menuitem" @click="menuAction('add')"><AppIcon name="notes" :size="15" />在此加入笔记</button>
          <button class="menu-item" role="menuitem" @click="menuAction('chapter')"><AppIcon name="folder" :size="15" />新建子章节</button>
          <span class="menu-separator" aria-hidden="true"></span>
        </template>
        <button v-if="menu.node.kind === 'folder'" class="menu-item" role="menuitem" @click="menuAction('rename')">重命名</button>
        <button class="menu-item" role="menuitem" :disabled="menuNodeIndex <= 0" @click="menuAction('up')">上移</button>
        <button class="menu-item" role="menuitem" :disabled="menuNodeIndex < 0 || menuNodeIndex >= menuSiblings.length - 1" @click="menuAction('down')">下移</button>
        <button class="menu-item" role="menuitem" @click="menuAction('move')">移动到…</button>
        <button v-if="menu.node.kind === 'note'" class="menu-item" role="menuitem" @click="menuAction('detach')">移出笔记本，转为独立笔记</button>
        <span class="menu-separator" aria-hidden="true"></span>
        <button class="menu-item danger" role="menuitem" @click="menuAction('remove-node')">删除</button>
      </template>
    </ActionMenu>
    <DeleteNotebookDialog :open="!!deleting" :name="deleting?.name ?? ''" :count="deleting?.nodes.filter(n => n.kind === 'note').length ?? 0" :busy="deletionBusy" :error="deletionError" @confirm="confirmDelete" @cancel="deleting = null" />
    <Teleport to="body">
      <ConfirmDialog :open="!!confirm" :title="confirm?.title ?? ''" :message="confirm?.message" confirm-text="删除" @confirm="confirmAction" @cancel="confirm = null" />
      <Transition name="dialog">
        <div v-if="dialog" class="dialog-mask" @click.self="dialog = null">
          <div ref="panel" class="dialog kb-workspace-dialog" role="dialog" aria-modal="true" :aria-label="dialog === 'chapter' ? '章节名称' : dialog === 'add' ? '加入已有笔记' : dialog === 'move' ? '移动目录' : '解决笔记本冲突'">
            <template v-if="dialog === 'chapter'">
              <h3 class="dialog-title">{{ chapterEditing ? '重命名章节' : '新建章节' }}</h3>
              <label class="dialog-field">章节名称<input v-model="chapterTitle" class="dialog-input" aria-label="章节名称" maxlength="100" @keydown.enter="!$event.isComposing && saveChapter()" /></label>
              <label v-if="!chapterEditing" class="dialog-field">创建位置<select v-model="createParent" class="dialog-input" aria-label="创建位置"><option value="">根目录</option><option v-for="{ node, path } in creationFolders" :key="node.id" :value="node.id">{{ [...path, node.title].join(' / ') }}</option></select></label>
              <div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">取消</button><button class="dialog-btn ok" :disabled="!chapterTitle.trim() || busy" @click="saveChapter">保存</button></div>
            </template>
            <template v-else-if="dialog === 'add'">
              <h3 class="dialog-title">加入已有笔记</h3>
              <input v-model="pickerQuery" class="dialog-input" placeholder="搜索已有笔记" aria-label="搜索已有笔记" />
              <label class="dialog-field">加入位置<select v-model="createParent" class="dialog-input" aria-label="加入位置"><option value="">根目录</option><option v-for="{ node, path } in creationFolders" :key="node.id" :value="node.id">{{ [...path, node.title].join(' / ') }}</option></select></label>
              <div class="kb-picker"><label v-for="note in picker" :key="note.id"><input v-model="chosen" type="checkbox" :value="note.id" :disabled="included.has(note.id)" /><span>{{ note.title || '无标题' }}</span><small v-if="included.has(note.id)">已加入</small></label><p v-if="!picker.length">没有可加入的笔记</p></div>
              <div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">取消</button><button class="dialog-btn ok" :disabled="!chosen.length || busy" @click="saveNotes">加入 {{ chosen.length }} 篇</button></div>
            </template>
            <template v-else-if="dialog === 'move'"><h3 class="dialog-title">移动「{{ moving ? label(moving) : '' }}」</h3><label>目标章节<select v-model="moveParent" class="dialog-input" aria-label="目标章节"><option value="">根目录</option><option v-for="{ node, path } in folders" :key="node.id" :value="node.id">{{ [...path, node.title].join(' / ') }}</option></select></label><p>移动后放在目标章节的末尾。</p><div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">取消</button><button class="dialog-btn ok" @click="saveMove">移动</button></div></template>
            <template v-else><h3 class="dialog-title">解决笔记本冲突</h3><p>请选择要保留的版本。两份内容均已保存为本机快照。</p><article v-for="conflict in conflicts" :key="conflict.id" class="kb-conflict"><h4>{{ libraries.books.find(b => b.id === conflict.book_id)?.name }} · {{ conflict.kind === 'toc' ? '目录' : '笔记本信息与移除状态' }}</h4><div class="kb-conflict-versions"><div><b>本机修改</b><p v-if="conflict.kind === 'meta'">{{ libraries.books.find(b => b.id === conflict.book_id)?.name }}<br />{{ libraries.books.find(b => b.id === conflict.book_id)?.description }}<br />{{ libraries.books.find(b => b.id === conflict.book_id)?.invalid ? '已移除' : '正常使用' }}</p><ol v-else><li v-for="{ node, depth } in flattenToc(libraries.tocs.find(t => t.knowledge_base_id === conflict.book_id)?.nodes ?? [])" :key="node.id" :style="{ marginLeft: `${depth * 12}px` }">{{ label(node) }}</li></ol><button class="dialog-btn ok" @click="resolve(conflict.book_id, conflict.kind, 'local')">保留本机修改</button></div><div><b>另一台设备</b><p v-if="conflict.kind === 'meta'">{{ conflict.conflict?.book.name }}<br />{{ conflict.conflict?.book.description }}<br />{{ conflict.conflict?.book.invalid ? '已移除' : '正常使用' }}</p><ol v-else><li v-for="{ node, depth } in flattenToc(conflict.conflict?.toc.nodes ?? [])" :key="node.id" :style="{ marginLeft: `${depth * 12}px` }">{{ label(node) }}</li></ol><p v-if="conflict.conflict?.book.invalid">笔记本已移除；保留本机目录会恢复笔记本。</p><button class="dialog-btn cancel" @click="resolve(conflict.book_id, conflict.kind, 'remote')">接受另一台设备</button></div></div></article><div class="dialog-footer"><button class="dialog-btn cancel" @click="dialog = null">稍后处理</button></div></template>
            <p v-if="error" class="kb-error" role="alert">{{ error }}</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped src="./knowledge-base.css"></style>
