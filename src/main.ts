import './styles.css'
import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { hasToken } from './api/token'
import { startSyncEngine } from './sync/engine'
import { onRemoteApplied } from './sync/signal'
import { useNotesStore } from './stores/notes'
import { useGroupsStore } from './stores/groups'
import { initSettings } from './settings'
import { clearLaunchParams, parseLaunchIntent } from './launch'

// 主题、字号、宽度在挂载前就落到 <html> 上，首帧不闪白
initSettings()

const app = createApp(App)
app.use(createPinia())

// 与首帧并行读取 IndexedDB；NoteList 仍会在视图数据过期时兜底重读。
const notes = useNotesStore()
// 分享目标 / 快捷入口带进来的意图：先建笔记再挂载，第一帧就落在新笔记上；
// 未登录时不建（建了也只会躺在本地），参数照样擦掉。
const intent = parseLaunchIntent(location.search)
clearLaunchParams()
if (intent && hasToken.value) {
  void notes.create().then((note) => (intent.body ? notes.saveBody(note.id, intent.body) : undefined))
} else {
  void notes.load()
}
app.mount('#app')

// iOS Safari 会在存储压力下清理 IndexedDB，先申请持久化
void navigator.storage?.persist?.()

const groups = useGroupsStore()

let stopEngine: (() => void) | undefined

watch(
  hasToken,
  (has) => {
    if (has && !stopEngine) {
      stopEngine = startSyncEngine()
    } else if (!has && stopEngine) {
      stopEngine()
      stopEngine = undefined
    }
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
