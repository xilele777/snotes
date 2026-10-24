# 2026-10-24 全量代码审计

范围:前端 UI/编辑器层、`shared/` 核心同步逻辑、`worker/` 后端(全部路由 + 迁移 + 触发器)、`server/` 自托管版、客户端数据层(`src/db` / `src/sync` / `src/api`)、基础设施与测试。排除 `tmp/perf-baseline`(性能基线快照)。

基线:`npm run test:all` 三套件全绿,`vue-tsc` 通过。

## 总体结论

不是屎山。分层清晰(`shared/` 纯函数前后端共用;`worker/createApp()` 双端复用,`server/` 仅适配层);同步协议采用 watermark 提交序时钟(触发器在 COMMIT 时分配 `update_time`)+ CAS 条件更新 + 幂等重放 + 冲突副本 + 对账围栏,设计质量显著高于平均。注释密度高且解释"为什么"。无上帝组件(最大 `VditorEditor.vue` 744 行)。

P0 / P1:无。高危面(保存竞态、XSS、注入、路径穿越、鉴权绕过、资源泄漏、IME、冲突丢失)逐项核查均有防御设计。

## P2(真实缺陷,本次全部修复)

| # | 问题 | 位置 | 状态 |
|---|------|------|------|
| P2-1 | 跨标签页"幻影草稿":`unsavedDrafts` 启动快照无 `storage` 事件同步,`waitForDraftSaves` 把别页草稿计入,SW 更新刷新被永久拦住;恢复面板显示已不存在的草稿,重试保存用过期 base 回写 | `src/editor/save-session.ts` | 已修复 |
| P2-2 | 全局 Esc 与编辑器浮层冲突:搜索框有词时 Esc 被 App 捕获层抢走清空搜索词,Vditor 表情/链接浮层(非 `aria-modal`)关不掉 | `src/components/shortcut.ts:112` + `src/App.vue` | 已修复 |
| P2-3 | 服务端 PATCH 属性字段不校验类型:`PATCH /api/notes/:id` 的 star/top/home_hidden/group_id/skin_color 与 `PATCH /api/groups/:id` 的 name/ord/color 直接入库,畸形客户端可写类型错乱的值(agent 路由反而全有 zod) | `worker/routes/notes.ts`、`worker/routes/groups.ts` | 已修复 |
| P2-4 | 分组写库与入队不在同一事务:`db.groups.update` 与 `enqueueProp` 分离,崩溃窗口内分组改动永不同步且无 dirty 自愈 → 跨端静默分叉 | `src/stores/groups.ts` | 已修复 |

## P3(本次全部修复)

| # | 问题 | 位置 | 状态 |
|---|------|------|------|
| P3-1 | `POST /api/notes/:id/history` 用无 LIMIT 的 `listNoteHistory` 拉全部历史(最多 20 条 × 1MB)仅为比较最新一条 | `worker/routes/notes.ts:324` | 已修复 |
| P3-2 | `rowToNoteMeta` 的 `Number(row.invalid) ?? 0` 兜不住 NaN(NaN 非 null,`??` 不触发) | `worker/db.ts:29` | 已修复 |
| P3-3 | kb pull 在类型校验之前就把 `until` 用于 `issueCheckpoint`,可写入 watermark 类型异常的 checkpoint 行(TTL 自清,无害) | `worker/routes/knowledge-bases.ts:81-88` | 已修复 |
| P3-4 | `notes.load()` 收到 `'metrics'` 视图落入默认分支,全量加载无消费方的列表 | `src/stores/notes.ts:277` | 已修复 |
| P3-5 | `shared/stats.ts` 热力图/连续天数用固定 `DAY_MS` 加法推进日期,夏令时回拨时区会错位(客户端 `stats-activity.ts` 已做对;中国无 DST,影响有限) | `shared/stats.ts:106-113,209-219` | 已修复 |
| P3-6 | StatsView / HistoryDialog 异步加载无 try/catch,DB 异常为 unhandled rejection,页面停在加载态 | `src/components/StatsView.vue`、`HistoryDialog.vue` | 已修复 |
| P3-7 | GroupSidebar 五处裸 `await` 无错误提示(对比 NoteList 有 try/catch+notify) | `src/components/GroupSidebar.vue` | 已修复 |
| P3-8 | 死代码:`KnowledgeBaseInfo.vue` 整个组件、`navigation.ts` 的 openStats/closeStats/openManagedView/openStatsNote、`image-upload.ts` 的 clipboardImageFiles | 见各文件 | 已修复 |
| P3-9 | 重复代码:日期格式化 4-5 份拷贝;笔记本"隐藏失效文件夹"剪枝逻辑在 KnowledgeBaseWorkspace 与 KnowledgeBaseHome 逐行重复 | 见各组件 | 已修复 |
| P3-10 | NoteDetail 的 `editorClasses` Map 只增不减;notify 单槽 toast 顶掉前一条的撤销操作 | 见各文件 | 已修复 |

## 已核实安全的设计取舍(非 bug)

- **离线编辑撞墓碑删除**:pull 的 `deleteLocal` 先存冲突副本再删本地(`pull.ts:205-207`),文字不丢。
- **墓碑 30 天回收 vs 极旧游标**:404/410 路径保留任务 + 冲突副本兜底,闭环成立。
- **XSS 防线**:存储保留原始 markdown,渲染/编辑统一在 VditorEditor 入口 `escapeRawHtml` 降级(动态哨兵防碰撞);全仓库唯一 `innerHTML` 在 markdown-clipboard 的惰性 `<template>` 解析,安全;WPS 同步内容走同一入口。
- **多标签并发同步**:Web Locks `snotes-sync` + 模块内 `inFlight` 双保险。
- **令牌**:静态单令牌模型,无刷新竞态;Cookie 仅限 `Path=/api/images/` + `SameSite=Strict`,仅 GET 图片。

## 测试评估

81 个测试文件,三套 vitest 配置无孤儿;契约测试 worker/server 双跑;e2e 双后端分片;e2e 直写 helper 已对齐 v4 拆表 schema。抽查的同步类测试均为行为级断言。覆盖缺口:多标签页竞态(P2-1)与服务端 PATCH 类型校验(P2-3)此前无测试,本次修复已补。

## 修复记录(2026-10-24)

- **P2-1**:`save-session.ts` 增加 `storage` 事件监听(别页保存/废弃 → 移除条目;别页更新 → 实时刷新内容,重试用新 base);`waitForDraftSaves` 只等待本会话拥有的草稿与在途保存,别页草稿不再阻塞本页更新刷新。新增 3 个测试。
- **P2-2**:`resolveShortcut` 的 Esc 分支在编辑器上下文不再清空搜索词,让浮层自行处理;App.vue 无需改动。新增测试。
- **P2-4**:`stores/groups.ts` 的 patch/move/remove 改为在单个 `db.transaction` 内完成写库与入队。新增 3 个故障注入回滚测试。
- **P2-3**:`worker/routes/notes.ts` 的 POST/PATCH 与 `worker/routes/groups.ts` 的 POST/PATCH 补 zod 校验(类型、取值范围,与 `shared/types` 契约一致;不收紧长度,避免旧备份导入被 400 拒绝),非法值 400 `invalid_body`。worker 测试补非法字段用例。
- **P3-1/2/3/4**:新增 `latestNoteHistory`(LIMIT 1)替代补录去重的全量拉取;`invalid` 白名单化;kb pull 校验前移;metrics 视图短路。
- **P3-5**:`shared/stats.ts` 的日桶、热力图周/日推进、连续天数扫描全部改为日历日推进(`setDate`),与 `stats-activity.ts` 同款,夏令时区不再错位;移除不再使用的 `DAY_MS`。
- **P3-6**:StatsView 增加 `error` 状态与重试按钮;HistoryDialog 本机快照读取失败给出提示而非静默空白。
- **P3-7**:GroupSidebar 的 submitDialog/menuColor/menuHomeFeed/menuMove/runRemove 补 try/catch + notify;新建/重命名失败时弹窗保持打开并保留已输入名字。
- **P3-8**:删除 `KnowledgeBaseInfo.vue`;删除 `navigation.ts` 的 openStats/closeStats/openManagedView/openStatsNote 及其仅存于测试中的 3 个用例;删除 `clipboardImageFiles` 及其测试块。
- **P3-9**:新增 `src/format.ts`(fmtFull/fmtRelative),HistoryDialog/NoteInfoDialog 共用;`shared/knowledge-base.ts` 新增 `visibleTocNodes`,KnowledgeBaseHome/KnowledgeBaseWorkspace 的两份逐行重复剪枝逻辑收敛为一份(新增 3 个测试)。
- **P3-10**:`editorClasses` 加 200 条上限(FIFO 淘汰);`notify` 改为「普通消息即到即换、带操作的消息不被顶掉、后来者排队(上限 3)」,连删笔记时第一条的撤销不再丢失;用户主动关闭清空全部。测试重写并新增排队/溢出/清场用例。
- 验证:`npm run test:all` 全绿(798 + 196 + 70 = 1064)+ `npm run typecheck` + `npm run build` + `check:bundle` 全过。
