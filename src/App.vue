<template>
  <TokenGate v-if="!ui.token" @success="ui.token = true" />
  <div v-else class="wps-shell">
    <aside class="wps-sidebar">
      <div class="wps-brand"><span class="wps-logo">W</span><span>WPS 便签</span></div>
      <nav class="primary-nav" aria-label="主菜单">
        <button :class="{selected: ui.view === 'all' && !groups.selected}" @click="selectHome"><span class="nav-icon">⌂</span><span>首页</span></button>
        <button :class="{selected: ui.view === 'calendar'}" @click="ui.view = 'calendar'"><span class="nav-icon">▣</span><span>日历</span></button>
        <button :class="{selected: ui.view === 'groups'}" @click="ui.view = 'groups'"><span class="nav-icon">▦</span><span>分组</span><span class="nav-add" @click.stop="createGroup">＋</span></button>
      </nav>
      <div class="sidebar-section-title">我的分组</div>
      <div class="sidebar-groups">
        <button v-for="g in groups.items" :key="g.group_id" :class="{selected: groups.selected === g.group_id}" @click="selectGroup(g.group_id)">
          <span class="group-dot" :style="{background: g.color || '#c4c4c4'}"></span><span class="group-name">{{ g.name }}</span><span class="group-count">{{ groupCount(g.group_id) }}</span>
        </button>
        <button v-if="!groups.items.length" class="empty-group" @click="createGroup">暂无分组</button>
      </div>
      <nav class="secondary-nav"><button :class="{selected: ui.view === 'trash'}" data-view="trash" @click="ui.view = 'trash'; groups.selected = null"><span class="nav-icon">♧</span><span>回收站</span></button></nav>
      <div class="sidebar-user"><span class="avatar">S</span><span class="user-name">我的便签</span><button class="more-button" aria-label="更多">•••</button></div>
    </aside>
    <section class="wps-list-pane">
      <header class="list-header" :class="{recycle: ui.view === 'trash'}">
        <div class="list-heading"><h1>{{ pageTitle }}</h1><span class="note-total" v-if="ui.view === 'all'">{{ filteredNotes.length }}</span></div>
        <div class="list-actions"><button v-if="ui.view === 'trash'" class="text-action danger" @click="cleanTrash">清空回收站</button><button v-if="ui.view === 'all'" class="new-note" aria-label="新建笔记" @click="notes.create"><span>＋</span>新建</button><button class="icon-button" aria-label="同步" title="同步" @click="syncNow">↻</button></div>
      </header>
      <SearchBar v-if="ui.view === 'all'" />
      <div class="list-body">
        <div v-if="ui.view === 'calendar'" class="calendar-empty"><div class="calendar-glyph">▣</div><strong>日历</strong><p>提醒和日程将在这里显示</p></div>
        <TrashView v-else-if="ui.view === 'trash'" />
        <template v-else>
          <div v-if="!filteredNotes.length" class="empty-notes"><div class="empty-note-icon">✎</div><p>{{ ui.query ? '没有找到匹配的便签' : '点击右上角新建，记录点滴' }}</p></div>
          <div v-for="note in filteredNotes" v-else :key="note.id" class="wps-note-row" :class="{active: note.id === notes.currentId}" @click="notes.currentId = note.id">
            <div class="date-rail"><span>{{ monthOf(note.update_time) }}</span><b>{{ dayOf(note.update_time) }}</b></div>
            <div class="row-main"><div class="row-title"><span v-if="note.top" class="tiny-pin">⌖</span>{{ note.title || '无标题便签' }}</div><div class="row-message">{{ note.summary || '暂无内容' }}</div><div class="row-meta"><span v-if="note.star" class="star-mark">★</span><span>{{ timeOf(note.update_time) }}</span></div></div>
            <img v-if="note.thumbnail" class="row-thumb" :src="note.thumbnail" alt=""><button class="row-menu" aria-label="便签操作" @click.stop="notes.trash(note.id)">•••</button>
          </div>
        </template>
      </div>
    </section>
    <main class="wps-editor-pane" :class="{'editor-empty': !notes.current || ui.view !== 'all'}">
      <template v-if="notes.current && ui.view === 'all'">
        <div class="editor-topbar"><div class="editor-tools"><button class="editor-icon" aria-label="置顶" title="置顶" :class="{on: notes.current.top}" @click="notes.props(notes.current!.id, {top: notes.current!.top ? 0 : 1})">⌖</button><button class="editor-icon" aria-label="星标" title="星标" :class="{on: notes.current.star}" @click="notes.props(notes.current!.id, {star: notes.current!.star ? 0 : 1})">★</button><span class="tool-divider"></span><button class="editor-icon" aria-label="粗体" title="粗体">B</button><button class="editor-icon italic" aria-label="斜体" title="斜体">I</button><button class="editor-icon" aria-label="列表" title="列表">☷</button><button class="editor-icon" aria-label="插入图片" title="插入图片">▧</button></div><div class="editor-status"><span class="saved-dot"></span>已保存</div><div class="editor-tools right"><button class="editor-icon" aria-label="移动分组" title="移动分组">⌑</button><button class="editor-icon danger-icon" aria-label="删除" title="删除" @click="notes.trash(notes.current!.id)">⌫</button></div></div>
        <div class="editor-scroll"><MilkdownEditor :note-id="notes.current.id" :content="notes.current.body" /></div>
      </template><div v-else class="editor-placeholder"><div class="placeholder-mark">W</div><p>选择一条便签开始编辑</p></div>
    </main>
  </div>
</template>
<script setup lang="ts">
import {computed,onMounted} from 'vue';import {useUiStore} from './stores/ui';import {useNotesStore} from './stores/notes';import {useGroupsStore} from './stores/groups';import {apiFetch} from './api/client';import TokenGate from './components/TokenGate.vue';import SearchBar from './components/SearchBar.vue';import TrashView from './components/TrashView.vue';import MilkdownEditor from './editor/MilkdownEditor.vue';
const ui=useUiStore(),notes=useNotesStore(),groups=useGroupsStore();const pageTitle=computed(()=>ui.view==='trash'?'回收站':ui.view==='calendar'?'日历':groups.selected?groups.items.find(g=>g.group_id===groups.selected)?.name||'分组':'便签');const filteredNotes=computed(()=>notes.items.filter(n=>!n.invalid).filter(n=>!groups.selected||n.group_id===groups.selected).filter(n=>!ui.query||`${n.title} ${n.body}`.toLowerCase().includes(ui.query.toLowerCase())).sort((a,b)=>b.top-a.top||b.update_time-a.update_time));const selectHome=()=>{ui.view='all';groups.selected=null};const selectGroup=(id:string)=>{ui.view='all';groups.selected=id};const groupCount=(id:string)=>notes.items.filter(n=>!n.invalid&&n.group_id===id).length;async function createGroup(){const name=window.prompt('新建分组');if(name?.trim())await groups.create(name.trim())}async function cleanTrash(){if(window.confirm('确定清空回收站吗？此操作无法恢复')){await apiFetch('/trash/clean',{method:'POST'});await notes.refresh()}}function syncNow(){window.dispatchEvent(new Event('online'))}const monthOf=(v:number)=>new Date(v).toLocaleDateString('zh-CN',{month:'2-digit'}).replace(/^0/,'');const dayOf=(v:number)=>new Date(v).getDate().toString().padStart(2,'0');const timeOf=(v:number)=>new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});onMounted(async()=>{await notes.refresh();await groups.refresh();if(navigator.storage?.persist)await navigator.storage.persist()})
</script>
