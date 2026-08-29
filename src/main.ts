import './styles.css'
import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { hasToken } from './api/token'
import { startSyncEngine } from './sync/engine'
import { onRemoteApplied } from './sync/signal'
import { useNotesStore } from './stores/notes'
import { useGroupsStore } from './stores/groups'

const app = createApp(App)
app.use(createPinia())

// 与首帧并行读取 IndexedDB；NoteList 仍会在视图数据过期时兜底重读。
const notes = useNotesStore()
void notes.load()
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
