# Snotes bug 修复 + D1/R2 监控页 设计文档

日期：2026-08-24
状态：已批准（用户确认设计决策）

## 背景

用户在真实使用中发现 7 类问题，并希望新增一个监控 CF 项目 D1/R2 指标的后台页面。本文档逐项给出根因与修复方案，以及监控功能的设计。

### 设计决策（用户已确认）

- Bug 6 的「up/down 组件」= **撤销/重做** 功能（顶栏按钮 + Ctrl+Z）。
- Bug 7 打开应用时详情区默认**选中列表第一条**（全视图与回收站一致，不记忆上次位置）。
- 监控页数据源 = **Cloudflare 官方 GraphQL Analytics API**。
- 监控页入口位置 = **左侧栏左下角用户区（云端同步图标旁边）**。
- 删除确认弹窗**覆盖所有删除操作**，包括移动端左滑删除。

---

## 1. 图片粘贴：重复两份 + 插入到末尾

### 根因

- **(b) 插入到末尾**：`src/editor/MilkdownEditor.vue` 的 `handleImageFiles` 用
  `pushMarkdown(editor, \`${latest}\n\n![](${placeholder})\`)`，把图片追加到整份
  markdown 末尾，而非光标位置。
- **(a) 复制两份**：`clipboardImageFiles` 从 `data.files` 与 `data.items` 各取一遍，
  靠 `name|size|lastModified|type` 去重。真实浏览器里同一张图两个视图的元数据常
  不一致（`files` 视图 name 为空、`lastModified=0`），去重键失效 → 同图插入两次、
  上传两次。现有 E2E 只喂了 `items` 单视图，未暴露此问题。

### 修复方案

**`src/editor/image-upload.ts`**
- `clipboardImageFiles` 改为**只从 `data.items` 读取**（`item.kind === 'file'` →
  `getAsFile()`），不再拼接 `data.files`。`data.files` 是 `items` 的子集视图，从源头
  消除双视图重复。保留按元数据去重（防御同一 DataTransfer 里重复 item）。

**`src/editor/MilkdownEditor.vue`**
- 新增基于 ProseMirror 事务的两个操作，取代整篇 `replaceAll(pushMarkdown)`：
  - `insertImageAtCursor(editor, blobUrl)`：`view.state.tr.replaceSelectionWith(
    schema.nodes.image.create({ src: blobUrl, alt: '' }))`，在光标处插入占位图。
    插入后不置 `syncingExternally`，让 listener 把新内容经 debounce 持久化。
  - `updateImageSrc(editor, fromUrl, toUrl)`：遍历 doc 找到 `src === fromUrl` 的
    image 节点，`tr.setNodeMarkup(pos, undefined, { ...attrs, src: toUrl })`。
    上传失败时改为删除该节点（`tr.delete` + 保留换行结构）。
- `handleImageFiles` 改为：for 每个文件 → 光标处插占位 → `uploadImage` →
  成功后换 src / 失败删节点 + `alert`。整篇不再 `replaceAll`，**光标与撤销历史均保留**。

### 交互不变项

- 图片仍走 `compress → /api/images/upload` 上传。
- `latest` / `onMarkdownChange` / `flush` 的防抖存储逻辑保持不变。

### 测试

- 单测：`clipboardImageFiles`（items 双视图去重）单独抽成可测纯函数验证不重复。
- E2E：粘贴图片到**文字中间**，断言光标位置只出现一张图、且可被 Ctrl+Z 撤销恢复文字。

---

## 2. 手机端返回：返回直接退到桌面

### 根因

应用为纯状态驱动（`ui.view` / `mobilePane` / `currentId`），无路由、无历史栈。
Android 系统返回键 / PWA 独立窗口默认返回即关闭窗口回桌面。

### 修复方案

**新增 `src/navigation.ts`**（History API 驱动的轻量导航栈，不引入 vue-router）

- 状态快照：`{ currentId, view, activeGroupId, mobilePane, drawerOpen }`。
- `pushNav()`：应用内导航前先把**当前快照** `history.pushState` 入栈，再修改状态。
- `popstate` 监听：回退到上一个快照并恢复全部字段；用防重入标志防双击双回退。
- 启动时 `history.replaceState(根快照)`：确保「根界面按返回」不直接退出应用
  （先保持在前，用户明确想退出才点系统退出）。

**接入点（`App.vue` / `NoteDetail.vue` / `GroupSidebar.vue` / `NoteList.vue`）**
- 移动端点笔记进入详情（`notes.currentId = id`）前入栈；
- `backToList()` 改为 `popNav()`；
- 抽屉开/关、切换视图（star/trash/group/all）入栈；
- 桌面端（>720px 无 mobilePane 切换）不重复入栈，仅对产生实际层级变化的动作入栈。

### 测试

- 单测：`navigation.ts` 的 push/pop 状态记录与恢复逻辑（用 `jsdom` + 假 History）。
- E2E：窄屏下点笔记 → 系统返回 → 回到列表；再返回 → 应用仍在（不退出）。

---

## 3. Markdown 表格无法识别

### 根因

`MilkdownInner` 只挂了 `commonmark` preset；表格/删除线/任务清单属于 GFM 扩展。

### 修复方案

**`src/editor/MilkdownEditor.vue`**
- 挂载 `gfm`（`@milkdown/kit/preset/gfm`，内部 `remark-gfm` 已随 preset 安装）。
- 前端标题/摘要提取（`shared/derive.ts`）确认表格不会污染标题提取即可，无需改动。

### 测试

- 单测：表格 markdown 渲染为 `<table>` 结构、序列化往返一致。
- 现有标题/摘要提取测试保持通过。

---

## 4. 列表 hover 红色大方块 + 删除无确认

### 根因

- `src/styles.css` `.note-item:hover .delete { transform: translateX(0) }`：
  桌面端暂停任意列表项就滑出一整块 80px×93px 红色删除块。
- `src/components/NoteList.vue`、`NoteDetail.vue` 删除按钮直接调 `notes.trash`，
  无确认。

### 修复方案

- **新增 `src/components/ConfirmDialog.vue`**：复用现有点弹窗样式
  （`.dialog-mask/.dialog`），标题 + 说明 + 取消/确定（黄色确定钮）。
- **`src/styles.css`**：去掉 `.note-item:hover .delete` 整块滑出；
  改为 hover 时显示一个右上角的 28px 垃圾桶小圆钮（桌面端），
  移动端左滑出现红色删除按钮保持；两处都经过确认弹窗后再删。
- **`NoteList.vue` / `NoteDetail.vue` / `TrashView.vue`**：所有 `notes.trash` /
  `purge` / `purgeAll` 前先弹 `ConfirmDialog`（确认文案区分「移入回收站」与
  「彻底删除/清空」）。

### 测试

- E2E：hover 列表项不再出现红色大块；点删除弹确认；确认后才删。
- 单测：`ConfirmDialog` 取消不触发回调。

---

## 5. 滚动条样式对照原站

### 修复方案

**`src/styles.css`** 新增 WebKit + Firefox 统一瘦滚动条：

- 宽度 6–8px、圆角、轨道透明、拇指 `--border-default`、
  hover 加深到 `--text-tertiary`。
- 应用范围：`.note-list`、`.editor-body`、`.groups`、`.op-popover.groups-pop`，
  并给 `html` 全局兜底。
- 桌面端 `@media (hover: hover)` 不强制隐藏（保留可见滚动条以明确可滚动提示）。

### 测试

- E2E（浏览器可截图验证即可，不写死视觉断言）；手工确认。

---

## 6. 撤销 / 重做不可用

### 根因

编辑器未挂载 history 插件，`Ctrl+Z` 无效；顶栏无撤销/重做按钮。

### 修复方案

**`src/editor/MilkdownEditor.vue`**
- 挂载 `history`（`@milkdown/kit/plugin/history`），自带
  `Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y` 快捷键。
- 通过 `editor.action(undoCommand / redoCommand)`（`@milkdown/kit/plugin/history`
  已导出）校验按钮可用性；`MilkdownInner` expose `undo()/redo()`。
- 事务式图片插入与 history 兼容（ProseMirror 历史以 transaction 为单位）。

**`src/components/NoteDetail.vue`**
- 顶栏 `.op-bar` 前置撤销/重做两个弯箭头按钮（只读态/回收站隐藏）：
  `data-op="undo"/"redo"`，调用子组件暴露的方法。

### 测试

- E2E：输入文字 → 图片粘贴 → Ctrl+Z 撤销图片及文字、Ctrl+Shift+Z 重做；顶栏按钮等效。

---

## 7. 打开默认选中第一条

### 修复方案

**`src/stores/notes.ts` `load()`**
- 加载完成后：`currentId.value = notes.value[0]?.id ?? currentId` 当
  `currentId == null`（或当前 id 已不在列表时回退到第一条）。
- 全视图与回收站共享同一 `load`，行为一致。

### 测试

- 单测：空列表 `currentId` 保持 null；列表非空且无选中时置为第一条；trash 视图同理。

---

## 8. 监控页：D1/R2 指标（CF GraphQL Analytics API）

### Worker 侧

- **新增 `worker/routes/metrics.ts`**，`POST /api/metrics/types`，经现有 `auth` 鉴权。
- **`wrangler.jsonc`** 新增 secret 型绑定说明（不在配置文件里写明文）：
  `CF_ACCOUNT_ID`、`CF_API_TOKEN`（用户需在 CF 建 **Account Analytics Read** token，
  存为 `login` 后 `wrangler secret put`）。
- Worker 内 `fetch('https://api.cloudflare.com/graphql')`，携带 token，按需查询：
  - **D1**：`viewer.accounts{ filter{accountTag} d1DatabaseAnalyticsAdaptiveGroups
    filter{database: <database_id> datetime_geq/leq} }` → 读/写行数、SQL 次数、
    平均耗时、按天聚合近 7 天趋势。
  - **R2**：`r2StorageAdaptiveGroups filter{ bucketName }` → 对象数、存储量
    (payload_size)、ClassA/ClassB 操作数、近 7 天趋势。
  - **HTTP（可选）**：`httpRequests1dGroups` 请求量。
- 全部指标经同一个 **CF GraphQL 标准查询层**（`worker/metrics/graphql.ts`），
  每个指标一个"提取器"函数，便于单测 mock。

### 前端侧

- **入口**：`GroupSidebar.vue` 左下角 `.user-area`（云端同步图标旁）加一个
  「数据监控」图标按钮 → 设 `ui.view = 'metrics'`。
- **新增 `src/components/MetricsView.vue`**：
  - 顶部小卡片：D1 今日读/写行数、SQL 次数；R2 存储量、对象数。
  - 近 7 天趋势：纯 CSS 柱状条（不引图表库）。
  - 加载/错误/空态三态处理，错误态给出重试。
- **`src/api/client.ts`** 新增 `apiMetrics()` 封装（带鉴权头）。
- **UI 状态**：`ui.view` 扩展 `'metrics'`；`App.vue` 列表区按 view 渲染 `MetricsView`。

### 安全

- CF API Token 只存在 Worker secret，不出现在前端任何地方。
- 监控路由沿用现有 token 鉴权，防止未授权访问指标。

### 测试

- Worker 单测：mock 全局 fetch 的 GraphQL 响应，验证返回结构、错误透传。
- 前端单测：`MetricsView` 渲染卡片/趋势/错误态。
- 部署说明：README 补充「建 token → 存 secret → 监控可用」步骤。

---

## 实施顺序与验证

1. Bug 3（GFM 表格）
2. Bug 6（撤销/重做）
3. Bug 1（图片粘贴）
4. Bug 4（删除交互 + 确认弹窗）
5. Bug 7（默认选第一条）
6. Bug 5（滚动条）
7. Bug 2（手机端返回）
8. 监控页（最大，最后）

每项完成后跑对应单测/E2E；全部完成后跑
`npm run typecheck && npm run test:all && npm run test:e2e` 全量验证。

### 风险

- History API 快照与现有状态耦合点较多（抽屉、视图、currentId），回退恢复时需防
  与 `mobilePane` watch 竞争（先恢复快照再触发，或以防重入标志串行）。
- CF GraphQL 查询维度若与账号权限不符（如缺 zone 权限），HTTP 部分可能 403 ——
  设计上把 HTTP 做成可选指标，错误时该卡片显示"无权限"而非整页失败。
- GFM preset 与现有 `commonmark` 层叠顺序：`commonMark` 在前、`gfm` 在后。