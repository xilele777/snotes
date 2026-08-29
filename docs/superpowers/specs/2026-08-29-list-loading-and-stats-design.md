# 列表加载态 + 跨设备打开统计 + 统计页改版 设计文档

日期：2026-08-29
状态：待用户复核

## 背景

用户提出三个问题：

1. 笔记列表首次打开时会闪一下空状态（「还没有笔记」），随后才铺满列表。
2. 打开次数只统计本地，换设备看到的数字对不上。
3. 统计页布局呆板、信息密度低。

三者互相独立，但都落在「列表 / 统计」这条线上，合并为一个版本交付。

### 设计决策

- 打开次数口径 = **全设备累计总次数**（per-device 行 + 服务端求和）。
- 统计页新增指标 = 写作节奏（连续天数）、写作时段 24h、笔记长度分布、最近打开榜。
- 统计页布局 = **Bento 不等宽网格**（12 栅格，模块宽度按信息量分配）。

---

## 1. 列表首屏闪空

### 根因

`src/components/NoteList.vue:79` 在 `onMounted` 里发起 `notes.load()`，而
`src/components/NoteList.vue:101` 的 `EmptyState` 判据是 `notes.visible.length === 0`。
store 的 `notes` 初值是 `[]`，`load()` 是异步的 IndexedDB 查询——**挂载到数据回来之间的
这一帧，「空数组」被当成了「确实没有笔记」**，于是先渲染空状态插画，再被真实列表替换。

同一个缺陷影响三处：`NoteList.vue`、`TrashView.vue:38`（同样以 `length === 0` 判空），
以及切换视图/分组时——旧视图的数据会滞留到新查询返回，短暂显示错误内容。

### 修复方案

**区分「没加载过」与「加载完是空的」**，用一个已加载标记而非数组长度。

`src/stores/notes.ts`：

```ts
const loadedKey = ref<string | null>(null)
let loadSeq = 0

/** 当前视图 + 分组的组合键，用于判断手上的数据是否属于当前视图 */
function viewKey(): string {
  return `${ui.view}:${ui.activeGroupId ?? ''}`
}

/** 手上的数据不属于当前视图（含从未加载）→ 该显示骨架屏而不是空状态 */
const stale = computed(() => loadedKey.value !== viewKey())

async function load() {
  const seq = ++loadSeq
  const key = viewKey()
  const rows = await repo.listNotes({ view: ui.view as ListView, groupId: ui.activeGroupId })

  // 快速连切视图时会有多个 load 并发，晚返回的旧查询不能覆盖新结果
  if (seq !== loadSeq) return

  notes.value = rows
  loadedKey.value = key
  // ...currentId 的两条不变量保持不变
}
```

`stale` 与 `loadSeq` 一起导出（`loadSeq` 仅内部使用，不导出）。竞态守卫是必需的：
没有它，「切到回收站 → 全部视图的旧查询后返回」会让 `notes` 与 `loadedKey` 永久错配，
骨架屏再也不消失。

**新增 `src/components/ListSkeleton.vue`**：4 条占位行（标题条 + 两行摘要条），
复用现有 `--skeleton` 灰阶做 shimmer 动画。无 props。

`NoteList.vue` / `TrashView.vue` 的渲染分支改为三态：

```vue
<ListSkeleton v-if="notes.stale" />
<EmptyState v-else-if="notes.visible.length === 0" ... />
<ul v-else class="note-list">...</ul>
```

**冷启动再提前一步**：`src/main.ts` 目前在 `app.mount()` 之后才取 store。
改为 `app.use(createPinia())` 之后、`mount()` 之前就发起 `void notes.load()`，
让 IndexedDB 查询与 Vue 首次渲染并行，多数情况下数据在首帧就位、骨架屏根本不出现。
`app.use(pinia)` 会 `setActivePinia`，此时 `useNotesStore()` 可用。

`NoteList.vue:79` 的 `onMounted` 改为 `onMounted(() => { if (notes.stale) void notes.load() })`，
避免与 `main.ts` 的预加载重复读一次全表。

### 测试

- `src/stores/notes.test.ts`：新增 `stale` 初值为 `true`；`load()` 后转 `false`；
  并发 `load()` 时晚返回的旧结果被丢弃（mock `listNotes` 让第一次 resolve 慢于第二次）。
- `src/components/NoteList.test.ts`：未加载时渲染 `ListSkeleton` 而非 `EmptyState`；
  加载完且无数据才渲染 `EmptyState`。

---

## 2. 打开次数跨设备累计

### 现状

`src/stores/notes.ts:28-43` 的 `watch(currentId)` 调 `repo.openNote(id)`，
把 `open_count` / `last_open_time` 写进 IndexedDB。这两个字段**从不进 outbox、
从不上行**，因此每台设备各记各的。

### 数据模型

新增迁移 `migrations/0003_note_open.sql`：

```sql
CREATE TABLE note_open (
  note_id        TEXT    NOT NULL,
  device_id      TEXT    NOT NULL,
  count          INTEGER NOT NULL DEFAULT 0,
  last_open_time INTEGER NOT NULL DEFAULT 0,
  update_time    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (note_id, device_id)
);

CREATE INDEX idx_note_open_update ON note_open(update_time);
```

**不加 `note_id` 外键**。客户端新建笔记后会立刻选中它（`load()` 的默认选中逻辑），
这时该笔记可能还没 push 成功，服务端 `note` 表里没有对应行；有外键则整批上报被拒。
孤儿行由显式 DELETE 清理，见下。

### 协议

`shared/types.ts` 新增：

```ts
export interface OpensSyncRequest {
  device_id: string
  /** 上次同步拿到的 server_time；首次为 0 */
  since: number
  items: { note_id: string; count: number; last_open_time: number }[]
}

/** 服务端聚合的「其它设备」打开数据，不含请求方自己 */
export interface OpenAggregate {
  note_id: string
  others_count: number
  others_last_open_time: number
}

export interface OpensSyncResponse {
  opens: OpenAggregate[]
  server_time: number
}
```

`worker/routes/opens.ts` 新增 `POST /api/notes/opens`，在 `worker/app.ts` 注册。
一次请求同时完成上报与拉取，省一个往返。

上报（`env.DB.batch` 一次提交）：

```sql
INSERT INTO note_open (note_id, device_id, count, last_open_time, update_time)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(note_id, device_id) DO UPDATE SET
  count          = excluded.count,
  last_open_time = excluded.last_open_time,
  update_time    = excluded.update_time
```

`count` 是**覆盖**而非累加——客户端上报的是它本地的累计值，重发同一批不会翻倍。

拉取（增量）：

```sql
SELECT note_id,
       SUM(count)          AS others_count,
       MAX(last_open_time) AS others_last_open_time
  FROM note_open
 WHERE device_id != ?
   AND note_id IN (SELECT note_id FROM note_open WHERE update_time >= ?)
 GROUP BY note_id
```

`server_time` 在查询**之前**取（与 `worker/routes/sync.ts` 的 pull 同理），
下次作为 `since` 传回；用 `>=` 而非 `>`，同一毫秒的数据会重复返回，客户端幂等覆盖。

校验：`device_id` 非空字符串；`items` 长度上限 500，超出返回 400；
`count` 为非负整数、`last_open_time` 为非负整数，否则 400。

**清理**：`worker/db.ts:33` 的 `purgeNotes` 是墓碑化（`invalid=2`）而非物理删除，
但正文与图片在此刻就已回收——打开统计同理，在同一个 `batch` 里加
`DELETE FROM note_open WHERE note_id IN (...)`。
`worker/db.ts:72` 的 `reapTombstones` 里再加同样一条兜底，清掉历史遗留的孤儿行。

### 客户端

`shared/types.ts` 的 `LocalNote` 新增两个字段（均为本地派生，不参与 push）：

```ts
/** 其它设备累计的打开次数（服务端聚合，不含本设备） */
open_others?: number
/** 其它设备最近一次打开时间 */
open_others_time?: number
```

IndexedDB meta 表新增三个键：

- `device_id`：首次启动生成 `crypto.randomUUID()` 并持久化。清浏览器数据会换新 ID，
  该设备的历史计数在服务端仍以旧 ID 存在，**总数不变**，只是不再被本设备覆盖更新。可接受。
- `opens_cursor`：上次响应的 `server_time`，初值 0。
- `opens_dirty`：待上报的 `note_id` 数组。只存 id，上报时按 id 从 `notes` 表现读
  `open_count` / `last_open_time`，保证发出去的永远是最新累计值。

`syncOpens()` 先取 `opens_dirty` 的**快照**再发请求，成功后只从 dirty 里移除快照中的 id——
请求飞行期间新产生的打开不会被误清。

新增 `src/sync/opens.ts`：

```ts
export const OPENS_THROTTLE_MS = 60_000

/** 上报 dirty 集 + 拉聚合写回 IndexedDB，成功后清空 dirty、推进 cursor */
export async function syncOpens(): Promise<void>

/** 节流入口：距上次不足 60 s 则挂 timer 延后，否则立即发 */
export function scheduleOpensSync(): void

/** 页面隐藏时清 timer 立即发，避免关标签页丢计数 */
export function flushOpensSync(): Promise<void>
```

接入点：

- `src/db/repo.ts` 的 `openNote()` 成功后把 `id` 加入 `opens_dirty`，
  调 `scheduleOpensSync()`。
- `src/sync/engine.ts` 的 30 s 轮询（`POLL_INTERVAL_MS`）里顺带调 `syncOpens()`；
  `visibilitychange` 转 hidden 时调 `flushOpensSync()`。

**不搭 push/pull 的车**，独立端点：打开统计与笔记内容的失败语义不同（丢一次计数无所谓，
不该让它把 outbox 的重试计数搅乱），且 `pullOnce` 的游标语义要保持单一。
60 s 节流 + 只在可见时轮询，额度成本与现有同步同量级。

### 口径与展示

「总打开次数」= `(open_count ?? 0) + (open_others ?? 0)`。
「最近打开」= `max(last_open_time ?? 0, open_others_time ?? 0)`。

`open_count` 保留原义（本设备），文档信息弹窗仍可显示本设备值；统计页一律用总数。

### 已知行为（不改）

冷启动时 `load()` 会默认选中列表第一条（`src/stores/notes.ts:75`），
这会计一次打开。因此「打开次数」包含了每次开应用对首条笔记的自动选中——
这是 v0.2 起的既有语义，本次不动，仅在此记录以免日后误判为 bug。

### 测试

- `tests/worker/opens.test.ts`：同一 payload 发两次 `count` 不翻倍；
  聚合排除请求方自己的 `device_id`；`since` 增量只返回变更过的 note；
  `purgeNotes` 后对应 `note_open` 行消失；`items` 超 500 返回 400。
- `src/sync/opens.test.ts`：节流窗口内多次 `scheduleOpensSync()` 只发一个请求；
  响应写回 `open_others` 并推进 `opens_cursor`；请求失败时 `opens_dirty` 不清空。

---

## 3. 统计页 Bento 改版

### 新增指标

`shared/stats.ts` 的 `computeNoteStats` 扩展返回值（签名不变，跨设备字段已挂在 `LocalNote` 上）：

| 字段 | 定义 |
|---|---|
| `streakCurrent` | 当前连续更新天数。今天有更新则从今天起算；今天无、昨天有则从昨天起算；否则 0 |
| `streakLongest` | 历史最长连续更新天数 |
| `byHour` | 24 个桶，按 `update_time` 的本地小时计数，**全量**笔记（非 53 周窗口） |
| `lengthBuckets` | 四档：`<100` / `100–499` / `500–1999` / `≥2000` 字，只算 `invalid === 0` |
| `avgWords` | `totalWords / active`，`active` 为 0 时取 0 |
| `longest` | 字数最多的一条 `{ id, title, words }`，无笔记时 `null` |
| `recentOpened` | 按 `max(last_open_time, open_others_time)` 倒序 Top 5，过滤值为 0 的，元素为 `{ id, title, time }` |

「有更新」的判据与热力图一致：该日有笔记的 `update_time` 落入，且 `invalid !== 2`。
`mostOpened` 改用总数排序，字段名从 `open_count` 改为 `total_count`（避免与本设备值混淆）。

### 布局

`.stats-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px; }`

| 模块 | 宽度 |
|---|---|
| 数字带（无卡片框，一行到底，`·` 分隔，`tabular-nums`） | `span 12` |
| 更新热力图 53 周 | `span 8` |
| 写作时段 24h | `span 4` |
| 近 30 天创建 + 更新（双色堆叠柱，取代现在的两个 7 天图） | `span 12` |
| 长度分布 | `span 3` |
| 分组分布 | `span 3` |
| 打开榜（最常 / 最近，Tab 切换） | `span 6` |

数字带承载 6 项：笔记数、总字数、连续天数、星标数、置顶数、最早创建日。
现有的 4 张 KPI 卡片被它取代——一行文字带信息量相同、占高不到卡片的三分之一。

`avgWords` 与 `longest` 放在「长度分布」卡片里：四档柱子下方一行副文案
「平均 N 字 · 最长《标题》M 字」，点标题跳到那条笔记。

响应式断点：

- `≤1200px`：`repeat(6, 1fr)`；热力图/时段/30 天各 `span 6`，长度/分组 `span 3`，打开榜 `span 6`。
- `≤720px`：`repeat(1, 1fr)`；全部 `span 1`。

打开榜的 Tab 用组件内 `ref<'most' | 'recent'>('most')`，不入路由、不持久化。

### 测试

- `shared/stats.test.ts`：`streakCurrent` 的三种起算情形与跨月连续；`byHour` 落桶
  （含 23 点与 0 点边界）；`lengthBuckets` 的四个分档边界值（99/100/499/500/1999/2000）；
  `recentOpened` / `mostOpened` 在跨设备字段参与后的排序。
- `src/components/StatsView.test.ts`：打开榜 Tab 切换渲染对应列表。

---

## 版本与发布

新功能、向后兼容 → **MINOR**，目标版本 `v0.4.0`。

`CLAUDE.md` 的「当前版本」写的是 `0.1.0`，而最近一次发布是 `v0.3.1`——
该字段已过期，本次一并更新为 `0.4.0`。

数据库迁移编号独立递增：`0003_note_open.sql`。

## 不做的事

- 不记录逐次打开的事件流（只存 per-device 累计值），避免行数随使用无限增长。
- 不做统计页的时间范围筛选器。
- 不改热力图的 53 周窗口。
- 不做服务端预聚合统计——客户端纯函数在几千条规模下是毫秒级。
- 不把 `open_count` 并入现有 push/pull 协议。
