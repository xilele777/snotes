import './styles.css'
import './workspace.css'
import './pages.css'
import './motion.css'
import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { hasToken } from './api/token'
import { startSyncEngine, syncNow } from './sync/engine'
import { onRemoteApplied } from './sync/signal'
import { useNotesStore } from './stores/notes'
import { useGroupsStore } from './stores/groups'
import { initSettings } from './settings'
import { clearLaunchParams, parseLaunchIntent } from './launch'
import { initNavigation, openNotebookLink } from './navigation'
import { notify } from './notify'
import { registerSW } from 'virtual:pwa-register'

let offlineScheduled = false
function scheduleOfflineInstall() {
  if (offlineScheduled) return
  offlineScheduled = true
  const register = () => registerSW({ immediate: true })
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(register, { timeout: 2500 })
  else setTimeout(register, 0)
}

// 主题、字号、宽度在挂载前就落到 <html> 上，首帧不闪白
initSettings()

const app = createApp(App)
app.use(createPinia())

// 与首帧并行读取 IndexedDB；NoteList 仍会在视图数据过期时兜底重读。
const notes = useNotesStore()

// Warm the editor chunk after the first list paint. Vditor/Lute is intentionally
// code-split, but fetching it only when a note is opened made the first editor
// view appear as a blank pause on mobile. Idle preloading keeps it off the
// critical first render while removing that pause for the common next action.
function warmEditorChunk(): Promise<void> {
  return new Promise(resolve => {
    const load = () => {
      if (!hasToken.value) { resolve(); return }
      // Download the editor's three bootstrap resources as well as the
      // Vue chunk. Vditor otherwise starts these only after a tap, which is a
      // visible blank pause on a cold mobile cache. They are async and do not
      // block the first list paint.
      void Promise.all([
        import('./editor/VditorEditor.vue'),
        import('./editor/vditor-assets').then(({ loadVditorAssets }) => loadVditorAssets()),
      ]).then(() => resolve(), () => resolve())
    }
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(load, { timeout: 500 })
    else setTimeout(load, 0)
  })
}
// 分享目标 / 快捷入口带进来的意图：先建笔记再挂载，第一帧就落在新笔记上；
// 未登录时不建（建了也只会躺在本地），参数照样擦掉。
const intent = parseLaunchIntent(location.search)
clearLaunchParams()
// Explicit share/shortcut intents start a new destination instead of resuming an old page.
if (intent) history.replaceState(null, '', '/')
// Restore the destination before loading its data or mounting child components.
initNavigation()
if (intent?.kind === 'new' && hasToken.value) {
  void notes.create().then((note) => (intent.body ? notes.saveBody(note.id, intent.body) : undefined))
} else {
  void notes.load()
}
app.mount('#app')

// iOS Safari 会在存储压力下清理 IndexedDB，先申请持久化
void navigator.storage?.persist?.()

const groups = useGroupsStore()

let stopEngine: (() => void) | undefined
let linkConsumed = false

watch(
  hasToken,
  (has) => {
    if (has && !stopEngine) {
      const editorWarm = warmEditorChunk()
      stopEngine = startSyncEngine()
      // A first installation downloads offline assets. Start it after the
      // initial sync so it cannot compete with note recovery for mobile bandwidth.
      void syncNow().then(() => {
        // Workbox's installation fetch bypasses the HTTP cache; wait for the
        // editor bootstrap as well so it cannot download Lute twice in flight.
        void editorWarm.then(scheduleOfflineInstall)
        return notes.finishSelectionRestore()
      })
      if (intent?.kind === 'open' && !linkConsumed) {
        linkConsumed = true
        void syncNow().then(() => openNotebookLink(intent.notebookId, intent.noteId)).catch(() => notify('暂时无法打开笔记链接，请稍后重试。'))
      }
    } else if (!has && stopEngine) {
      stopEngine()
      stopEngine = undefined
    }
    if (!has) scheduleOfflineInstall()
  },
  { immediate: true }
)

// 事件驱动而非定时轮询：pull 真正写了东西才刷新。
// 每 2 秒无条件重读整个 IndexedDB 在几千条笔记规模下会明显拖慢界面，
// 而且刷新时机与数据落库时机对不上，会看到迟一拍的内容。
onRemoteApplied(() => {
  void notes.load()
  void groups.load()
})
