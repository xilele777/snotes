# 1.0.0 发布前全项目审查

> 本文保留当时审查结果；恢复协议、备份与真实环境的后续结果以[2026-10-20 验收补充](2026-10-20-v1-acceptance.md)为准。

审查日期：2026-10-19
当前版本：`package.json` / `package-lock.json` 为 `0.24.1`
审查结论：**功能基础已达到可用，但暂不建议直接发布 1.0.0。先关闭 P0/P1 数据可靠性问题，完成编辑器启动预算与发布门禁，再进入 RC。**

## 本轮修复进度（2026-10-19）

本文件保留修复前的问题清单和性能基线；下文的问题描述不代表当前实现仍然全部如此。实际修复、回归证据、性能复测和未关闭项统一记录在 [本轮修复记录](2026-10-19-v1-repairs.md)。本轮不升级应用版本、不提交标签、不推送、不部署。

## 审查范围与证据边界

本次检查覆盖：

- Vue、Pinia、路由、设置、列表与搜索、笔记本工作区、回收站、历史、导入导出、图片上传、分享、PWA。
- Dexie schema/repository、outbox、push/pull、冲突副本、普通笔记和笔记本同步。
- Cloudflare Worker 的鉴权、Notes/Groups/Trash/Images/Sync/Agent/MCP/指标路由，D1/R2 维护任务。
- Node SQLite 适配器、图片磁盘适配器、HTTP 静态服务、限流、Docker/Compose/Caddy/systemd 配置。
- shared 类型、派生字段、同步归约、历史规则、备份格式、100 个测试文件和现有文档。

代码规模约为：`src` 154 个文件/23,669 行（含测试），Worker 24 个文件/2,573 行，server 6 个文件/378 行，shared 21 个文件/2,090 行，测试约 100 个文件/14,293 行。核心路径已逐文件检查，辅助页面和配置做了逐项检索与抽样；“全项目审查”表示已覆盖所有模块边界和关键数据流，不把它表述成形式化证明每一行没有问题。

修复前基线证据：

- `npm run test:all`：前端/shared 807 项、Worker 184 项、server 55 项，共 **1,046 项全部通过**。
- `npm run build`：类型检查和生产构建通过。
- `npm run test:e2e`：Worker 后端 **99 项通过**。
- `npm run test:e2e:server`：Node 后端 **99 项通过**。
- 临时复现脚本位于被忽略的 `tmp/`，部分断言曾因测试环境和事务构造不正确而失败，不作为发布通过证据。修复记录只统计已纳入仓库并实际通过的回归测试。
- `npm audit --omit=dev --registry=https://registry.npmjs.org` 报告 12 个依赖项（5 high、1 moderate、6 low、0 critical）。这是依赖树告警数量，不等于 12 个已被本应用利用的漏洞；仍应在 RC 前升级并复测。

未完成的真实环境验证：真实 Cloudflare D1/R2 限额、真实公网压缩和 CDN、旧版本升级链、iOS Safari/WebKit、Firefox、真实手机输入法和生产 Docker 容器运行。Docker 客户端存在，但当前 Docker Desktop daemon 未运行，所以没有把容器“已验证”写进结论。

## 发布阻断项

下表按“数据丢失/不可恢复”优先级排列。P0/P1 关闭并有回归测试后，才应进入 1.0.0 RC。

| 等级 | 问题与位置 | 已确认的触发方式 | 影响 | 修复与验收 |
| --- | --- | --- | --- | --- |
| P0 | ACK 与 outbox 删除不是同一事务，[push.ts:89](../../src/sync/push.ts:89)、[push.ts:141](../../src/sync/push.ts:141) | 服务端 ACK 返回后，在 `outbox.get()` 与 `delete()` 之间写入新的正文任务 | 新正文仍在本地，但 outbox 被删除；下一次同步不会上传。`applyAck` 也可能用旧 ACK 清掉新改动的 dirty/version | 在一个 Dexie `rw` 事务内读取任务、检查 `seq`、更新 note、条件删除任务；更新 dirty/version 前再次确认同一 seq。加入延迟 ACK、跨标签页、连续输入测试 |
| P0 | 墓碑复活的并发请求会混合元数据和正文，[notes.ts:46](../../worker/routes/notes.ts:46) | 两个请求同时创建同一个 `invalid=2` id；条件元数据更新成功者与无条件 body upsert 成功者不是同一请求 | 两个请求均 200，但最终可能是“请求 A 的标题 + 请求 B 的正文”，客户端认为自己的 create 已完整保存 | 用单事务/条件 UPDATE 的 `changes` 结果确认唯一获胜者；正文写入必须受同一条件保护，失败者返回可重试冲突。并发 create 回归要求只能形成一份一致记录 |
| P0 | 图片引用生命周期按所属笔记检查，[maintenance.ts:59](../../worker/maintenance.ts:59)、[db.ts:40](../../worker/db.ts:40) | 笔记 B 复制了笔记 A 的图片 Markdown；A 不再引用，7 天后清理任务只看 A 的 body | 删除 B 仍在使用的 R2 对象。`purgeNotes` 也在数据库事务前删除 R2，DB 失败会留下已损坏的正文 | 短期：全局扫描所有 live body、历史和备份引用后再删；延迟清理并记录失败。长期：图片引用表/引用计数 + 可重试 cleanup queue。验收覆盖跨笔记复制、历史恢复、离线 8 天后重新同步 |
| P0 | D1 绑定参数超过平台限制，[db.ts:40](../../worker/db.ts:40)、[maintenance.ts:20](../../worker/maintenance.ts:20)、[trash.ts:7](../../worker/routes/trash.ts:7) | `purgeNotes` 的 101 个 id 会生成 102 个绑定参数；当前批量值 200。Cloudflare D1 文档规定每条语句最多 100 个 bound parameters（见 <https://developers.cloudflare.com/d1/platform/limits/>） | 本地 SQLite 测试可通过，生产 D1 可能直接失败，回收站/定时维护无法完成 | 统一 `QUERY_BIND_LIMIT=80`，所有 `IN`、墓碑回收、图片删除和清空回收站走同一分批函数；用“强制最多 100 bindings”的 fake D1 测试，并在 staging D1 跑 101/1000 条数据 |
| P1 | 请求超时只覆盖 headers，[client.ts:60](../../src/api/client.ts:60) | `fetch()` 返回 Response 后，`finally` 立即清理计时器；`res.json()`/`res.blob()` 的 body 无限停顿 | 15 秒超时失效，sync `inFlight` 永远占住，界面一直同步中；调用方 AbortSignal 也被覆盖 | 将 controller 与 caller signal 合并，超时包住读取 body；区分 timeout/offline/用户取消。验收为 headers 立即返回、body 20 秒不结束时 15 秒必拒绝，用户取消不触发重试 |
| P1 | “点击重试”不会重试永久失败任务，[engine.ts:24](../../src/sync/engine.ts:24)、[push.ts:121](../../src/sync/push.ts:121) | 4xx 任务写入 `failed=1`；`retrySyncNow()` 只修改 `failed=0` 的任务，push 又跳过 `failed=1` | 红点永久存在，用户只能按运维文档手工编辑 IndexedDB；这不符合正式产品的可恢复性 | 增加失败任务面板：保留 payload、错误、时间；临时性错误一键 retry，400 需编辑/放弃并明确提示。至少“重试后发出 PATCH”回归测试；不要无限重试明确无效的 payload |
| P1 | 编辑器交接先清 pending，保存失败无兜底，[VditorEditor.vue:55](../../src/editor/VditorEditor.vue:55)、[NoteDetail.vue:234](../../src/components/NoteDetail.vue:234) | `handOff()` 先把 pending 置空并更新 base，再 fire-and-forget `notes.saveBody()`；Quota/DB 失败时无 await、无错误通知、无安全草稿 | 用户看到输入已写入但本机没有 durable row/outbox；`pagehide` 的异步写入也不能保证浏览器终止前完成 | `saveBody` 返回确认后再提交 base，失败时保留 pending、显示重试/导出草稿；加 IndexedDB quota/关闭库/页面隐藏测试。保存状态需区分“本地已保存/待同步/失败” |
| P1 | 30 天墓碑保留不能保证长期离线恢复，[db.ts:81](../../worker/db.ts:81) | 设备离线超过 30 天后才连接；或服务端从旧备份恢复，客户端 cursor 比服务端水位新 | 普通笔记 pull 可能永远错过删除/恢复的元数据；PATCH 404 会丢失同步语义；恢复后的旧数据可能不再被拉取 | 增加 server sync epoch/checkpoint；epoch 变化执行全量 id reconcile，保留本地未确认 outbox；长期离线先导出/保留本地 recovery copy。验收模拟 31 天、服务器恢复、断点中途失败 |

## Vditor 白屏/卡顿的结论

当前已有一些正确优化：Vditor chunk 延迟加载、语言/Lute/icon 并行预热、避免同步 icon XHR、首屏骨架、首次解析不再重复、列表虚拟化、正文批量同步。问题因此不是一个简单的“加 loading”就能解决。

构建体积基线：

| 资源 | 未压缩 | gzip |
| --- | ---: | ---: |
| 主入口 JS | 282,626 B | 91,077 B |
| Vditor chunk | 311,363 B | 77,353 B |
| Vditor CSS | 44,596 B | 9,071 B |
| `lute.min.js` | **3,743,299 B** | **601,698 B** |
| icon script | 42,983 B | 12,034 B |

在 390×844、4 倍 CPU 降速、4 Mbps/40ms、500 条合成笔记的相同条件下，当前 3 轮结果为：

- 列表显示中位数：约 **1,383 ms**。
- 点击首条到编辑器正文可用：约 **1,658 ms**。
- 缓存后刷新恢复编辑器：约 **646 ms**。
- 首次打开记录到 Lute：gzip 下载约 **602 KB**，约 1,542 ms；资源缓存不能消除首次解析/初始化。
- 冷启动累计长任务约 **1,033 ms**。
- 诊断单轮出现约 **594 ms** 的主线程长任务，发生在 Lute 加载/编辑器初始化阶段。
- Node 默认静态服务没有 `Content-Encoding`；同一模拟下未压缩首次点击约 **11.4 s**，Lute 传输约 3.74 MB。这是生产部署级别的明确性能缺口。
- 约 76,000 字符、2,000 段落压力正文：首次打开约 **9.7 s**，缓存刷新约 **12.3 s**，出现约 5.8 s 与 2.6 s 的长任务。该场景说明 Lute 解析、Vditor 三种编辑模式初始化和 DOM/render 都需要预算。

建议的启动时序：

```text
首屏 HTML/CSS/列表
  └─ 立即绘制可交互列表（目标 P75 < 1.5 s，4G 手机条件）
       └─ 用户打开笔记：优先该笔记的编辑模式和 Lute
            ├─ 先显示只读 Markdown/纯文本预览，避免白屏
            ├─ 编辑器资源下载/解析/初始化
            └─ ready 后切换可编辑态
```

按顺序实施：

1. Node 使用 Brotli/gzip 静态压缩；Caddy 示例加入 `encode zstd gzip`；为带 hash 的 assets/vendor 设置 `Cache-Control: immutable`，确认 `Vary: Accept-Encoding`。不要把 profile 脚本里临时 gzip 的结果当成 Node 生产结果。
2. 预热策略从“所有用户 idle 加载”改为“恢复到有选中笔记且设备/网络允许时优先加载；空白列表、低带宽、后台标签页延后”。预热和 Service Worker 安装不得争抢同一份 Lute。
3. 保留编辑器容器与实例，切换普通笔记时只更新 value；避免 `App.vue` 的视图 key 导致离开/进入笔记本反复构造 Vditor。切换期间继续保留保存 session。
4. 长文采用阈值策略：超过约 50–100 KB 先显示只读预览，用户点击编辑再初始化；记录首屏可见、Lute parse、Vditor ready、first input 四个时间点。若要拆分正文，必须先做 schema/迁移和历史兼容，不作为本轮轻量修复。
5. 对 IR/WYSIWYG/SV 做真实手机基准；不要默认三种模式都在打开时初始化。检查 outline、全量 `getValue()`、MutationObserver 和首屏 parse 是否可按模式关闭或延迟。
6. 建立性能门禁：普通 500 条笔记冷启动 P75 `<2.0 s`、点击到编辑器 ready P75 `<1.5 s`、warm refresh P75 `<0.8 s`；100 KB 正文 ready P75 `<3 s`。测试失败应给出资源体积和长任务诊断，而非只测“元素最终出现”。

## 其他已确认缺陷与优化项

### 数据、同步与备份

| 优先级 | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| P1 | [shared/derive.ts:7](../../shared/derive.ts:7) | `IMAGE_RE` 不识别 Vditor/导入常见的 `![](< /api/images/... >)` 或无空格 angle destination，缩略图会丢失 | 使用 Markdown destination 解析或先规范化 angle wrapper；补充 WYSIWYG/IR/SV 和导入格式测试 |
| P1 | [backup.ts:522](../../src/export/backup.ts:522) | `uploaded` 按图片文件名全局去重，并把第一次上传的 note id 绑定到后续笔记；跨笔记同名/复用图片会得到错误 owner | 去重键改为内容 hash + 引用集合，或每个 owner 上传；导入结束校验每个 `/api/images` 均可读 |
| P1 | [backup.ts:395](../../src/export/backup.ts:395) | `unzipSync` 没有 zip 条目数、压缩后总大小、单文件大小和重复路径上限 | 导入前做 ZIP bomb 防护，超限时给出可恢复错误；导入采用 staging/逐项报告，失败后保留未完成清单 |
| P1 | [backup.ts:466](../../src/export/backup.ts:466) | 导入恢复 `create_time`，没有恢复 `update_time`；同 id 存在时跳过，无法修复内容/图片损坏 | 明确 restore/merge 两种模式；restore 允许用户选择覆盖，并为缺失资源输出报告 |
| P1 | [README.md](../../README.md) 与 backup 实现 | “完整备份”主要包含当前正常笔记和笔记本；普通回收站、普通正文历史不完整纳入，容易产生用户预期差 | UI 和文档明确备份范围，或增加“包括回收站/历史”选项；导出前显示预计大小和内容范围 |
| P1 | [sync/engine.ts:24](../../src/sync/engine.ts:24) | pull 成功会把 `lastSyncError` 清掉，即使仍有失败 outbox；用户可能看到“自动同步”但本地还有未推送改动 | 将 `pendingLocal`、`failedPermanent`、`lastNetworkError` 分离显示；同步完成状态必须包含 outbox 计数 |
| P1 | [sync/engine.ts](../../src/sync/engine.ts) | 只有模块内 `inFlight`，多标签页没有 Web Locks/BroadcastChannel leader | 单用户多标签页会重复 push/pull、产生不必要冲突；加 leader/锁并测试两个 tab 同时编辑 |
| P2 | [shared/stats.ts](../../shared/stats.ts) / `worker/metrics/collect.ts:73` | 指标趋势裁成最近 7 天后，额度计算也用裁后的数组；月累计和“本月最高单日”只覆盖 7 天 | 保留全月 aggregate，图表单独裁 7 天；补充月中前 6 天有峰值的测试 |
| P2 | [share.ts:67](../../src/export/share.ts:67) | `navigator.share()` 的 AbortError 被当成复制兜底，用户取消可能仍复制/提示 | 返回 `cancelled`，仅不支持分享时复制；UI 显示正确结果 |
| P2 | [compress.ts:14](../../src/editor/compress.ts:14) | 图片很小或 canvas context 失败时提前 return，`ImageBitmap.close()` 未执行 | `try/finally` 释放 bitmap；补充移动端连续上传内存测试 |
| P2 | [server.env.example](../../server.env.example) | 注释写“empty or 0 = off”，实际空值解析为默认 30 天，`0/off` 才关闭 | 改注释为“empty = 30 days; 0/off = off”，避免误配置自动清理 |
| P2 | [worker/routes/notes.ts:24](../../worker/routes/notes.ts:24) | 只检查 `create_time` 是 number，允许 `1e100` 等无效时间；不同页面的 `toISOString` 可能抛 RangeError | shared boundary schema 统一检查 safe integer、非负、合理上限；所有 API 错误返回稳定 4xx |
| P2 | Worker routes | Notes/Groups 的普通写入依赖类型断言，字段范围/字符串大小未完全共享；Node 12 MiB body limit 与 D1 行约 2 MB 不一致 | 共享 Zod schema、正文大小上限和错误码；大正文要明确“不支持同步”而不是让 outbox 永久失败 |

### 性能与可维护性

- `src/db/repo.listNotes` 仍会把所有 note body `toArray()` 后才过滤；`notes.visible` 每次搜索把整篇正文 `toLowerCase()`，每次保存还会触发排序。先做 metadata-only 查询、规范化文本缓存和 100–150 ms debounce；只有真实 profile 证明必要时再迁移正文存储。
- `NoteDetail` 一进入就订阅完整 knowledge-base 数据，[NoteDetail.vue:186](../../src/components/NoteDetail.vue:186)；笔记本工作区也有订阅。普通笔记应只加载轻量 membership，当前活动笔记本才加载 nodes/tasks/引用正文，并保证全局单一订阅。
- `KnowledgeBaseWorkspace` 多处重复 `childrenOf`/`descendantsOf`，[KnowledgeBaseWorkspace.vue:131](../../src/components/KnowledgeBaseWorkspace.vue:131)，目录规模达到 1,000 节点会出现 O(n²)；建立 children/index，一次 flatten，必要时虚拟树。
- `VditorEditor.vue` 近 700 行、`NoteDetail.vue` 约 615 行、`backup.ts` 约 542 行。只做职责拆分：`editor-session`、`vditor-assets`、上传/剪贴板、history facade；backup 拆成 archive/validation/image-ref/import，但保留当前公开函数，避免大规模重写。
- 删除 Milkdown 依赖和已不使用的组件可以减少安装体积和维护面，但当前生产 bundle 已不含 Milkdown，删除依赖本身不会直接解决首屏下载。先用 import graph 确认 `format.ts`、sanitize、table、clipboard 等共享模块，再分提交移除。
- README 和 `docs/development.md` 仍写 Milkdown，[README.md:118](../../README.md:118)、[docs/development.md:48](../../docs/development.md:48)；`scripts/shoot.ts` 仍定位 `.milkdown`。应改成 Vditor，并让截图脚本重新覆盖核心页面。
- 没有 ESLint/Prettier/EditorConfig、Node engines、CI 和 bundle budget。1.0 前加入最小 CI：Node 24、typecheck/build/test 三后端、两套 e2e、依赖 audit、bundle gzip/decoded budget；浏览器矩阵至少 Chromium + WebKit，Firefox 可作为 nightly。
- PWA 使用 `autoUpdate`，[pwa.config.ts:44](../../pwa.config.ts:44)；Workbox 默认更新可能直接 reload。编辑器输入时自动刷新会损伤 caret/undo/IME，应该在无 dirty/pending/save 后提示更新，或由 `onNeedRefresh` 控制。
- 图片 `CacheFirst` 一年且服务端允许 public immutable，[pwa.config.ts:97](../../pwa.config.ts:97)；这是离线体验与删除即时生效之间的产品取舍。1.0 必须提供“清除本设备缓存/注销时清除图片缓存”的明确入口，并在永久删除后清理对应 CacheStorage。

## 与成熟个人知识产品的差距

当前已经具备成熟产品的基础形态：本地优先、离线编辑、多端同步、冲突副本、回收站、历史、图片、可导出、笔记本目录和 Agent API。差距主要在可靠性闭环，而不是功能数量：

1. 成熟产品会明确显示“本地已保存、正在同步、同步失败、冲突待处理”，并让用户从界面恢复失败任务；当前失败任务仍需要运维手册操作。
2. 成熟产品把备份定义成可验证的恢复流程：导出范围、校验、断点、失败报告、图片引用完整性和旧版本兼容都可见；当前导入是逐项写入，失败时缺少 staging 和恢复清单。
3. 成熟产品会给出可靠性目标和性能预算，而不是只等待 DOM 出现；当前有 profile 脚本，但没有 CI 门禁、真实设备基线和长文预算。
4. 成熟产品优先做移动端 IME、无障碍、键盘、焦点、离线恢复和更新安全；当前 E2E 全部 Chromium，中文输入法、iOS storage eviction、WebKit/PWA update 尚未实机验证。
5. 多用户协作、CRDT、E2EE、团队权限不是这个单用户自托管产品 1.0 的必要差距。先把单用户数据不丢、能恢复、能导出、能快速打开做好，范围更健康。

## 建议的实施顺序

### 阶段 A：数据安全（必须先做）

1. Dexie ACK/seq 事务与多 tab 锁。
2. 失败任务模型、重试/放弃/导出 UI。
3. fetch body timeout + caller cancellation。
4. 图片全局引用、延迟清理、跨 note 导入修复。
5. D1 绑定参数统一分批、staging D1 验证。
6. 墓碑复活 CAS/事务、长离线 epoch 设计。

### 阶段 B：编辑器和启动

1. Node/Caddy 压缩和 immutable headers。
2. 首屏列表、编辑器 skeleton/只读预览、Vditor 实例复用。
3. Lute/模式/长文 profile，按启动预算收敛。
4. 失败保存保留 pending，显示本地保存状态。
5. 500 条普通笔记和 100 KB/1 MB 长文在移动 Chromium/WebKit 上各跑 3 轮。

### 阶段 C：可维护性与产品完成度

1. 修正文档、截图脚本、Milkdown dead code/依赖。
2. 共享输入 schema、正文/ZIP 限制、稳定错误码。
3. CI、依赖升级、bundle/startup budget、日志和健康检查。
4. 备份恢复演练、旧版本升级演练、生产配置审查、无障碍/IME 手工验收。

以当前代码规模估计，阶段 A+B+C 约需要 8–12 个工作日的实际实现与复测；这是排期估计，不是质量承诺。任何数据模型迁移都应先做备份和回滚演练，再决定是否纳入 1.0。

## 1.0.0 发布门禁

发布前必须满足：

- P0/P1 项全部有修复和回归测试；`npm run test:all`、`npm run build`、两套 e2e 通过。
- Worker staging 完成 100/1,000 条 purge、跨 note 图片、并发恢复、断网/超时、长离线和旧版本升级演练。
- Node 生产静态资源确认 Brotli/gzip，profile 的 Lute 与 Vditor chunk 不超过预算；长文超阈值有明确只读/编辑行为。
- Chromium/WebKit + 至少一台真实 iOS/Android 设备完成中文 IME、粘贴、图片、撤销、pagehide、PWA 更新和 storage pressure 检查。
- 导出→清空→导入能恢复标题、属性、图片、笔记本目录、冲突/历史范围；失败导入能给出可操作报告。
- 修复 npm audit 中可升级依赖，特别是 Vue、Hono、fast-uri、source-map-js、prosemirror-view；不使用 `npm audit fix --force` 破坏锁定版本。
- 更新 CHANGELOG、README/开发文档和部署文档；补充 CI 和回滚说明。
- 版本仍以 `package.json` 为唯一来源；候选阶段使用预发布版本，稳定发布时同步 `package-lock.json`，按 `AGENTS.md` 执行 `chore(release): v1.0.0`、tag、push、deploy、记录 Cloudflare Deployment/Version ID 和 GitHub Release。当前审查没有修改版本号、没有提交 tag、没有部署。

达到这些门禁后，1.0.0 才是一个可维护、可恢复、打开速度有证据、发布过程可追踪的正式版本。
