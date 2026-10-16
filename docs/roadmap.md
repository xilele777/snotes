# 功能建议与待办

- 日期：2026-09-19
- 基线：v0.7.1，main 分支 a98e911
- 状态：实施中。第一档 1 与第二档 1 已完成，第二档 2、第一档 2、第一档 3、第一档 4 已于 v0.9.0 发布，第二档 3、第二档 5、第一档 5 已于 v0.10.0 发布，第三档 0、1、2 已于 v0.11.0 发布，第三档 3、4 已于 v0.12.0 发布，第三档 5 已于 v0.13.0 发布，第四档 1 到 5 已于 v0.14.0 发布。实施顺序第 1 到第 7 步全部完成。
- 来源：对 `src/`、`shared/`、`worker/`、`server/` 的代码审阅。各项「现状」均为代码中确认的事实，不是推测

## 第一档：补齐半成品

这些功能的数据模型或后端已经就绪，只差界面入口，投入最小。

### 1. 分组管理补全

- 现状：`src/components/GroupSidebar.vue` 里分组行的「更多」按钮只打开重命名弹窗。`src/stores/groups.ts` 已实现 `remove()`，但没有任何组件调用。`Group.color` 与 `Group.ord` 字段存在，`worker/routes/groups.ts` 的 PATCH 已接受 `name`、`ord`、`color`，DELETE 也已实现，侧栏与统计页已按 `color` 渲染图标和色点，但没有设置颜色和排序的入口。
- 建议：把「更多」改成菜单，提供重命名、标记颜色、上移下移、删除。删除走 `ConfirmDialog`，文案说明组内笔记会回到未分组。颜色复用笔记的 6 色皮肤板。
- 不做会怎样：建错的分组永远删不掉，只能改名复用；颜色字段一直空着。
- 涉及：`GroupSidebar.vue`、`GroupDialog.vue`、`stores/groups.ts`，后端不改。
- 成本：小。

### 2. 编辑工具栏

- 现状：`src/components/NoteDetail.vue` 的顶栏只有撤销、重做、插入图片。所有格式都靠手敲 Markdown 符号，手机键盘上很费劲；底部的「格式帮助」只是一张速查表。
- 建议：加标题、加粗、斜体、无序列表、有序列表、清单、引用、代码块、表格、链接、删除线。桌面直接排在顶栏，320px 以下收进一个「格式」弹层或横向滚动，保持现有 e2e 里「320px 下编辑工具栏完整可见」的约束。备选方案是 slash 菜单，但对手机用户不如按钮直观。
- 可直接使用的 Milkdown 命令：`wrapInHeadingCommand`、`toggleStrongCommand`、`toggleEmphasisCommand`、`wrapInBulletListCommand`、`wrapInOrderedListCommand`、`wrapInBlockquoteCommand`、`createCodeBlockCommand`、`toggleInlineCodeCommand`、`toggleLinkCommand`、`insertTableCommand`、`toggleStrikethroughCommand`、`addRowAfterCommand`、`addColAfterCommand`。任务清单没有现成命令，需要在 `src/editor/task-checkboxes.ts` 上补一个切换 `listItem.checked` 属性的命令。
- 不做会怎样：手机端基本只能写纯文本，表格和清单这些已经支持的格式没人用得上。
- 涉及：`NoteDetail.vue`、`src/editor/MilkdownEditor.vue`、`task-checkboxes.ts`、`styles.css`。
- 成本：小到中。

### 3. 链接处理

- 现状：`src/editor/` 没有任何链接相关代码。编辑态点击链接只会落光标，不会打开；没有插入或编辑链接的入口。
- 建议：光标落在链接上时显示小气泡，提供打开、编辑地址、复制、移除；Ctrl/Cmd 加点击直接在新标签打开；外链加 `rel="noopener noreferrer"`。插入链接与第 2 项工具栏共用 `toggleLinkCommand`。
- 不做会怎样：粘贴进来的网址只能复制出去再打开。
- 涉及：`MilkdownEditor.vue`、`styles.css`。
- 成本：小。

### 4. 图片查看

- 现状：a98e911 之后点击图片改为把光标放到旁边，没有放大查看的方式。手机拍的照片在电脑端只能看压缩后的嵌入图。
- 建议：双击或长按打开灯箱，支持缩放、左右切换同一笔记内的图片、下载原图。灯箱复用 `dialog-mask` 的样式和 `useDialogFocus` 的焦点管理。
- 不做会怎样：以图片为主的笔记看不清细节。
- 涉及：`MilkdownEditor.vue` 或新组件 `ImageLightbox.vue`。
- 成本：小。

### 5. 快捷键扩展

- 现状：`src/components/shortcut.ts` 只解析新建、聚焦搜索、Esc 清除搜索。
- 建议：星标、置顶、删除当前笔记，列表上下条切换，专注模式切换，立即同步，切换到全部笔记或某个分组。在「格式帮助」弹层里列出，统一由 `resolveShortcut` 解析并保持纯函数可测。
- 不做会怎样：桌面重度用户每个操作都要离开键盘。
- 涉及：`shortcut.ts`、`App.vue`。
- 成本：小。

## 第二档：实用新功能

### 1. 导出与导入

- 现状：界面和 API 都没有导出、导入。备份只能靠 `wrangler d1 export` 或复制服务器数据目录，前者是 SQL 而不是 Markdown。`docs/server-deployment.md` 写明 Cloudflare 与独立服务器之间数据不会自动迁移。设计文档把「数据不再被锁死」当作核心价值，但用户目前拿不到自己的 Markdown。
- 建议：
  - 全部导出：从 IndexedDB 读全部笔记，打包 zip 下载。结构为每个分组一个文件夹、每条笔记一个 `.md`，正文里的 `/api/images/` 引用改写为相对路径并把图片一并放进 `images/`，另附 `index.json` 保存 id、分组、星标、置顶、颜色、创建与更新时间，供再导入时还原属性。zip 打包用按需加载的小依赖，不进首屏。
  - 导入：接受单个或多个 `.md`，也接受上述 zip。有 `index.json` 时还原属性与分组，没有时按文件夹建分组；图片重新上传到当前实例并改写引用。导入走 `repo.createNote`，自然进入同步队列。
  - 单条：顶栏加「复制 Markdown」和「下载 .md」；手机端加系统分享，用 `navigator.share` 把正文发到其他应用，不支持时退回复制。
  - 可选：服务端 `GET /api/export` 输出同样的 zip，方便脚本定时备份。
- 不做会怎样：换部署方式、换工具、或者服务端出问题时，用户无法带走数据，这与项目的立项理由直接冲突。
- 涉及：新组件、`stores/notes.ts`、`db/repo.ts`、`api/client.ts`，可选新增 worker 路由。
- 成本：中。

### 2. 深色模式与极简设置页

- 现状：`src/styles.css` 的 `:root` 已经有 25 个设计令牌变量，但只声明了 `color-scheme: light`，全项目没有 `prefers-color-scheme`，也没有任何设置入口。
- 建议：
  - 主题：跟随系统、浅色、深色三选一。实现为 `[data-theme="dark"]` 覆盖 `:root` 变量，加一段 `prefers-color-scheme` 媒体查询处理「跟随系统」。首帧前在 `index.html` 里内联读取 localStorage 设置主题，避免闪白。`<meta name="theme-color">` 随主题更新。6 色皮肤板、热力图色阶、缩略图边框在深色下需要单独校色。
  - 设置页：入口放在侧栏底部版本按钮旁，只放主题、字号、编辑区宽度三项，用 localStorage 保存，按设备生效，不进同步。
- 不做会怎样：夜间用手机记东西会刺眼；这是笔记类应用被问得最多的功能。
- 涉及：`styles.css`、`insights.css`、`index.html`、新组件 `SettingsDialog.vue`、`GroupSidebar.vue`。
- 成本：中。

### 3. 搜索多关键词

- 现状：`src/stores/notes.ts` 的 `visible` 对标题和正文做单个子串匹配；`SearchBar.highlight` 也只高亮一个词。搜索范围跟随当前视图，分组视图里已经只搜当前分组。
- 建议：空格分隔的多个词取交集，排序仍按标题命中优先；高亮支持多个词。分组视图里搜索无结果时，在空态里提供「在全部笔记中搜索」的出口。
- 不做会怎样：几百条笔记后，单个词的命中列表太长，只能靠回忆精确措辞。
- 涉及：`stores/notes.ts`、`SearchBar.ts`、`NoteList.vue` 空态。
- 成本：小。

### 4. 多选批量操作

- 现状：移动分组、星标、置顶、删除都只能逐条操作。
- 建议：列表进入多选态，桌面用「选择」按钮或 Ctrl/Shift 点选，手机长按。底部操作条提供移动分组、星标、置顶、删除；回收站视图则是恢复与彻底删除。实现为循环调用 `repo.updateProps`、`trashNote` 等现有方法，只在结束时 `load()` 一次；outbox 保持每条笔记一个任务。
- 不做会怎样：整理几十条旧笔记要点几十次。
- 涉及：`NoteList.vue`、`TrashView.vue`、`stores/notes.ts`。
- 成本：中。

### 5. PWA 分享目标与快捷入口

- 现状：`pwa.config.ts` 的 manifest 没有 `share_target` 和 `shortcuts`。
- 建议：第一步只做文字和链接，用 GET 方式的 `share_target`，应用启动时读取 URL 参数新建笔记并清理地址栏；`shortcuts` 加「新建笔记」。图片分享需要 POST 加 Service Worker 处理，vite-plugin-pwa 要切到 injectManifest 模式，放到第二步。iOS Safari 目前不支持 `share_target`，只能靠快捷指令调用 URL，这是平台限制。
- 不做会怎样：手机上看到想记的内容，要复制、切应用、新建、粘贴四步。
- 涉及：`pwa.config.ts`、`main.ts`、`navigation.ts`。
- 成本：小到中。

## 第三档：运维与健壮性

### 0. 共用前提：定时任务入口

- 现状：`wrangler.jsonc` 没有 `triggers.crons`，`server/index.ts` 没有定时器。下面第 1、2 项都需要一个周期性执行的地方。
- 建议：Worker 在 `worker/index.ts` 导出 `scheduled` 处理器并在 `wrangler.jsonc` 配置每日一次的 cron；服务器版在 `server/index.ts` 用 `setInterval` 每日执行同一份任务函数。任务函数放在 `worker/` 里供两端复用，与现有 `createApp` 同样的共用方式。
- 成本：小。

### 1. 孤儿图片回收

- 现状：`worker/db.ts` 的 `purgeNotes` 只在彻底删除笔记时按 `note_id` 删除 R2 对象和 `image` 表行。用户把图片从正文里删掉后，对象永远留在 R2 或磁盘上，`image` 表也不更新。
- 建议：定时任务扫描 `image` 表，对比对应笔记 `note_body.content` 里的 `/api/images/` 引用，不再被引用且创建超过 7 天的删除。宽限期是为了避开撤销和多端同步的时序问题。不推荐客户端在保存时同步删除，撤销后图片就找不回来了。顺便可以按 `image.size` 汇总存储用量，展示在文档信息或设置页。
- 不做会怎样：图片存储只增不减，慢慢吃掉免费额度。
- 涉及：定时任务、`worker/db.ts`、`server/images.ts`。
- 成本：中。

### 2. 回收站自动清理与墓碑回收定时化

- 现状：`worker/routes/trash.ts` 只在「清空回收站」时顺带调用 `reapTombstones`，用户从不清空的话墓碑永远不回收。回收站里的笔记没有过期机制。
- 建议：定时任务每日执行 `reapTombstones`；新增回收站保留期，超过保留期的 `invalid = 1` 笔记走 `purgeNotes`。保留期是部署级配置，Worker 用 `vars`、服务器用环境变量，默认关闭，README 说明后由部署者开启。
- 不做会怎样：回收站变成永久垃圾堆，`note` 表里的墓碑行只增不减。
- 涉及：定时任务、`trash.ts`、`db.ts`、`server/config.ts`、README。
- 成本：小到中。

### 3. 登录限流

- 现状：`worker/auth.ts` 对错误令牌没有任何节流，公网自托管时可以无限尝试。
- 建议：服务器版在内存里按来源 IP 记录失败次数，超过阈值返回 429 并逐步延长封锁，读取 `X-Forwarded-For` 时只信任反向代理，`deploy/Caddyfile.example` 已是这种拓扑。Cloudflare 版在文档里引导用 WAF 的速率限制规则按 `/api/` 路径与 401 响应计数，不在代码里引入 Durable Object。`TokenGate.vue` 收到 429 时提示稍后再试。
- 不做会怎样：单令牌是唯一凭据，无节流意味着安全性完全取决于令牌长度。
- 涉及：`server/app.ts`、`worker/auth.ts`、`TokenGate.vue`、`docs/server-deployment.md`。
- 成本：小。

### 4. 打印样式

- 现状：`styles.css` 没有 `@media print`，打印或存 PDF 会把侧栏、列表、顶栏一起打出来。
- 建议：打印时只保留 `.editor-body`，隐藏其余面板和按钮，图片限制最大宽度，避免代码块和表格被分页截断。不加打印按钮，浏览器快捷键即可。
- 不做会怎样：无法把一条笔记体面地打出来或存成 PDF。
- 涉及：`styles.css`。
- 成本：小。

### 5. 本地正文历史

- 现状：唯一的兜底是冲突副本，没有版本回溯。误删一大段并在 800 毫秒后落库，撤销栈随刷新消失后就找不回来。
- 建议：`src/db/schema.ts` 升到 `version(2)`，新增 `history` 表保存 `note_id`、时间、正文。`updateBody` 落库时若距上次快照超过 5 分钟或字数变化超过阈值就写一条；每条笔记保留最近 20 条且不超过 30 天。文档信息弹窗加「历史版本」列表，可预览与恢复，恢复前先把当前正文存为快照。纯本地，不同步，不导出；彻底删除时连带清理。
- 不做会怎样：误改只能靠冲突副本这种偶然机制，多数情况下丢了就是丢了。
- 涉及：`schema.ts`、`repo.ts`、`NoteInfoDialog.vue`。
- 成本：中。

## 第四档：入口与呈现方式整理

前三档把功能补齐了，但入口是「哪里有空放哪里」长出来的。这一档不加功能，只调整已有功能的入口、承载容器和提示方式，让它们贴合「手机随手记、电脑整理」的使用方式。完整设计见 `docs/superpowers/specs/2026-09-20-entry-points-design.md`，下面是摘要。

### 0. 问题

- 侧栏底部一行挤着同步状态、版本号、导出导入、设置四样，后两个是 28px 无文字图标，手机上要先开抽屉再到角落找。
- 编辑器底栏放了字数、文档信息、导出分享、格式帮助四个入口。底栏贴着屏幕底边，手机浏览器工具栏、系统手势区和软键盘都在这一带，经常点不到；11px 文字、28px 按钮也低于触控目标下限。
- 本地正文历史藏在「文档信息」里，刚误删内容的人想不到去点 ⓘ。
- 快捷键清单与 Markdown 速查放在手机也会看到的底栏弹层里，但那是桌面用户的事。
- 打印只有 Ctrl/⌘ P，手机没有快捷键；令牌没有退出入口。

### 1. 设置中心

- 建议：图标栏「统计」下方新增「设置」（桌面图标、抽屉里带文字标签），打开与统计同款的分页大弹窗：**外观**（主题、字号、宽度）、**数据**（导出全部、导入备份）、**快捷键**（全局快捷键、编辑器内快捷键、Markdown 速查）、**关于**（版本、更新与升级步骤、发布链接、退出登录）。侧栏底部只留同步状态与版本号，版本号直达「关于」页。有新版本时图标栏「设置」与版本号同时显示蓝点。新增快捷键 `Mod ,`。
- 涉及：`SettingsDialog.vue` 改为分页壳 + `src/components/settings/` 四个 pane、`GroupSidebar.vue`、`App.vue`、`stores/ui.ts`（`statsOpen` 泛化为 `overlay`）、`navigation.ts`（`openOverlay / closeOverlay`）、删除 `BackupDialog.vue`。
- 成本：中。

### 2. 笔记「更多」菜单

- 建议：顶栏最右加 ⋯，条目为文档信息、历史版本、字数统计 | 复制 Markdown、下载 .md、分享到其他应用、打印 / 存为 PDF | 删除（仅 ≤720px 显示）。手机 320px 顶栏没有余量，⋯ 顶替删除按钮的位置；删除仍可从菜单或列表左滑到达。只读态（回收站）条目减去分享与删除，恢复与彻底删除保持顶栏可见。从 `GroupMenu.vue` 抽出通用的 `ActionMenu.vue`（定位、键盘、外点关闭、焦点归还），两处共用。`Mod Shift D` 改为经 store 里的 `trashRequest` 触发确认弹窗，不再依赖 DOM 上有删除按钮。
- 涉及：新增 `ActionMenu.vue`、`NoteMenu.vue`、`useMediaQuery.ts`；`NoteDetail.vue`、`GroupMenu.vue`、`App.vue`、`stores/ui.ts`。
- 成本：中。

### 3. 底栏只做状态，提示改 Toast

- 建议：底栏不再有任何按钮。桌面显示「自动保存 · N 字」（只读态「只读 · N 字」），≤720px 整条隐藏，把空间还给正文。复制、下载、分享、恢复历史、链接气泡的提示统一改为顶部居中的 Toast（`src/notify.ts` + `Toast.vue`，`role="status"`，3.5 秒自动消失，只保留一条），顶部不受浏览器工具栏和键盘遮挡。
- 涉及：新增 `notify.ts`、`Toast.vue`；`NoteDetail.vue` 删除 `flash` 与 `.share-notice`；`styles.css`。
- 成本：小。

### 4. 历史版本独立弹窗

- 建议：把 `NoteInfoDialog.vue` 里的历史区块拆成 `HistoryDialog.vue`，作为 ⋯ 菜单的独立条目「历史版本」。加载时机、空态文案、只读态无恢复按钮都不变。
- 涉及：新增 `HistoryDialog.vue`；`NoteInfoDialog.vue` 只留元数据。
- 成本：小。

### 5. 两处小补

- 打印：⋯ 菜单加「打印 / 存为 PDF」，调用 `window.print()`。与第三档 4「不加打印按钮」的说法不同，理由是手机没有快捷键，而菜单项不占顶栏空间。
- 退出登录：设置「关于」页尾加按钮，确认后只清令牌（`clearToken`），不动 IndexedDB，界面回到令牌页。

### 已定的决策点

2026-09-20 按推荐项实施：手机底栏整条隐藏；手机顶栏给 ⋯ 让位的是删除；打印与退出登录随本次一起做；设置入口放图标栏底部。

## 第五档：表格编辑与高亮

设计见 `docs/superpowers/specs/2026-09-21-table-editing-and-highlight-design.md`。

### 1. 表格操作 UI

- 现状：表格插入后无法增删行列、调整对齐。
- 建议：接入 Milkdown 自带的 table-block 组件（已在依赖树里，无新包），换成项目图标并适配样式。

### 2. 表格后无光标

- 现状：表格在文末或紧挨图片时点击没有光标。
- 建议：启用 kit 的 cursor（gap cursor）与 trailing（文末保底空段落）插件。

### 3. 表格密度

- 建议：全局设置 `tableDensity`（紧凑 / 标准 / 宽松），落到 `<html data-table-density>`。不做逐表调整。

### 4. 高亮标记

- 建议：`==文字==` 语法，自写 remark 解析与序列化，工具栏加按钮，快捷键 `Mod-Shift-H`。

### 已定的决策点

- 字号、字体颜色不做：Markdown 没有对应语法，只能内联 HTML，与轻量存储冲突。

## 考虑过但暂不建议

| 项目 | 暂不做的理由 |
| --- | --- |
| 排序选项 | 当前固定为置顶优先、更新时间倒序，符合便签习惯。若确有需求，只加「按创建时间」一项 |
| 代码高亮 | 需要引入 prism 或 shiki，包体积明显增加，而项目一直在盯 gzip 体积。可作为按需加载的可选项 |
| 英文界面 | 面向 README.en 的用户，但要抽取全部界面文案，工作量不小。开源关注度上来后再评估 |
| 大纲或目录 | 设计文档定位「便签不是知识库」，长文很少 |
| 非图片附件 | 存储成本与预览复杂度都高，使用频率低 |
| 归档 | 与分组和回收站职责重叠 |
| 标签 | 与单层分组重叠，设计文档已明确只做分组 |
| 每日便签或模板 | 小众，可作为快捷键的变体在需要时补 |
| 冲突副本对比合并 | 频率低。本地正文历史做完后再看是否还需要 |
| 端到端加密 | 威胁模型是令牌泄露，加密不改善这一点，还会让图片、缩略图、迁移都复杂化 |
| 手动检查更新按钮 | 启动检查加 24 小时缓存已够，必要时在版本弹窗加一个按钮即可 |
| 提醒、协作分享、双链、AI、原生 App | 设计文档明确排除 |

## 建议的实施顺序

1. 第二档 1 导出与导入，顺手做第一档 1 分组管理补全。这两项分别解决数据可携带和明显的半成品。
2. 第二档 2 深色模式与设置页。
3. 第一档 2、3、4 工具栏、链接、图片查看，同属编辑器体验，一起做可以共用设计与测试。
4. 第二档 3、5 搜索多关键词、分享目标，以及第一档 5 快捷键。
5. 第三档 0、1、2 定时任务与两项清理，可以合成一个版本发布。
6. 第三档 3、4、5 限流、打印、本地历史。
7. 第四档 1 到 5 入口与呈现方式整理，一次发布 v0.14.0。实施顺序见设计文档第 10 节：先做无依赖的 `useMediaQuery`、Toast、`ActionMenu`，再拆历史弹窗，再做顶栏 ⋯ 与底栏，再改 `overlay` 导航，最后做设置分页与图标栏入口。已完成。

每完成一档中的一项，按 `CLAUDE.md` 的发布流程升 MINOR 版本；只改样式和文案的可以合并到下一次发布。

## 更新记录

- 2026-09-19：首版，基于 v0.7.1 代码审阅。
- 2026-09-19：第一档 1「分组管理补全」与第二档 1「导出与导入」（含单条复制/下载/系统分享）完成；可选的 `GET /api/export` 未做。
- 2026-09-20：v0.9.0 一次发布收拢以下四项，实施顺序第 3 步（编辑器体验）到此做完：
  - 第二档 2「深色模式与极简设置页」：主题三选一、正文字号、编辑区宽度，按设备存 localStorage；首帧脚本内联在 `index.html`。
  - 第一档 2「编辑工具栏」：正文上方新增一行格式按钮（标题、加粗、斜体、删除线、行内代码、清单、待办、引用、代码块、链接、表格），按压即切换并与光标处的格式联动点亮；新增 `src/editor/format.ts`（纯 ProseMirror 命令，可单测）、`src/components/FormatToolbar.vue`、`LinkDialog.vue` 与 `src/editor/link.ts` 的地址归一化与写入。
  - 第一档 3「链接处理」：光标落在链接上时浮出气泡（打开、编辑地址、复制、移除），Ctrl/Cmd 加点击直接新标签打开，外链补 `rel="noopener noreferrer"`；新增 `src/editor/link-tooltip.ts`（ProseMirror Plugin，气泡挂 body 用 fixed 定位），`copyText` 从 `copyMarkdown` 中拆出复用。
  - 第一档 4「图片查看」：双击或长按图片打开全屏灯箱（缩放 1–6 倍、放大后拖动、左右切换同笔记内图片、下载原图、方向键与 `+` `-` `0` `Esc` 快捷键）；新增 `src/components/ImageLightbox.vue`，取图逻辑抽为 `imagesAround` 供双击与长按共用。
- 开发过程中的四个中间版本提交（0.10.0、0.11.0、0.12.0）保留在 Git 历史里，但未作为独立版本发布，正式对外只有 v0.9.0 一个版本与标签。
- 2026-09-20：v0.10.0 完成实施顺序第 4 步：
  - 第二档 3「搜索多关键词」：`src/components/SearchBar.ts` 新增 `splitTerms` 与 `matchesAll`，`highlight` 支持多词并合并重叠区间；`stores/notes.ts` 的 `visible` 改为交集匹配；`shared/derive.ts` 的 `extractSearchExcerpt` 以最靠前的命中为中心截取；`NoteList.vue` 分组 / 星标视图搜索空态提供「在全部笔记中搜索」。
  - 第二档 5「PWA 分享目标与快捷入口」：`pwa.config.ts` 增加 GET 方式的 `share_target`（`/?share`）与 `shortcuts`（`/?new`）；新增 `src/launch.ts` 解析启动参数并在 `main.ts` 挂载前消费、擦除地址栏。图片分享（POST + injectManifest）未做。
  - 第一档 5「快捷键扩展」：`shortcut.ts` 新增星标、置顶、删除、上下条、专注、立即同步、全部笔记、第 N 个分组；数字键按 `event.code` 识别以兼容 Shift 变符号；`App.vue` 的 `runShortcut` 统一执行；「格式帮助」弹层列出 `SHORTCUT_LIST`。
- 2026-09-20：v0.11.0 完成实施顺序第 5 步，新增 `worker/maintenance.ts` 供两端共用：
  - 第三档 0「定时任务入口」：`worker/index.ts` 导出 `scheduled`，`wrangler.jsonc` 配置 `triggers.crons`（每日 03:17 UTC）；`server/index.ts` 启动 5 秒后先跑一次、之后 `setInterval` 每 24 小时一次，任务失败只记日志。
  - 第三档 1「孤儿图片回收」：`deleteOrphanImages` 用 `LEFT JOIN note_body` 加 `instr` 找出所属笔记正文不再引用且 `create_time` 超过 7 天的图片，先删对象再删索引行。存储用量汇总未做。
  - 第三档 2「回收站自动清理与墓碑回收定时化」：新增部署级配置 `TRASH_RETENTION_DAYS`（Worker `vars` / 服务器环境变量，`compose.yaml` 透传），默认关闭；`purgeExpiredTrash` 以 `update_time` 作为进回收站时间判断超期后走 `purgeNotes`；`reapTombstones` 改由每日任务调用。
- 2026-09-20：v0.12.0 完成实施顺序第 6 步的前两项：
  - 第三档 3「登录限流」：新增 `server/rate-limit.ts`（`LoginLimiter` 按来源计数、封锁翻倍封顶；`clientAddress` 只信任本机与私网对端的 `X-Forwarded-For`），`server/app.ts` 在 `/api/*` 前置中间件，`server/index.ts` 把 socket 对端地址放进 `Env.REMOTE_ADDRESS`。客户端 `api/client.ts` 识别 `error: 'too_many_attempts'` 的 429，清令牌并由 `markTooManyAttempts` 提示等待时长。Cloudflare 版按建议只在 README 引导配置 WAF 速率限制规则。
  - 第三档 4「打印样式」：`styles.css` 末尾新增 `@media print`，只保留 `.editor-body`，深色主题也按浅色打印，代码块换行、块级元素避免跨页，待办以 ☐ ☑ 呈现。
- 2026-09-20：v0.13.0 完成实施顺序第 6 步最后一项，roadmap 全部实施项到此做完：
  - 第三档 5「本地正文历史」：`src/db/schema.ts` 升 `version(2)` 新增 `history` 表（`++id, note_id, time`）；新增 `src/db/history.ts`（`shouldSnapshot` 纯函数判定、`maybeSnapshotIn` / `recordSnapshotIn` / `deleteHistoryIn` 事务内工具、`listHistory`），`repo.updateBody` 落库前按 5 分钟或 100 可见字符阈值把旧正文存快照，`purgeNote`、`purgeTrash` 与 pull 的墓碑删除连带清理；`repo.restoreFromHistory` 恢复前先把当前正文无条件存快照再走 `updateBody`。`NoteInfoDialog.vue` 加「历史版本」列表（预览、恢复，只读态无恢复按钮）。
  - 未做的可选项保持不变：存储用量汇总、图片分享目标、`GET /api/export`。
- 2026-09-20：新增第四档「入口与呈现方式整理」与实施顺序第 7 步。起因是前三档功能齐了之后入口散落：侧栏底部四个入口挤一行、编辑器底栏被手机浏览器工具栏和键盘遮挡、历史版本藏在文档信息里。方案是图标栏「设置」分页大弹窗收拢应用级入口、顶栏 ⋯ 菜单收拢笔记级入口、底栏只留状态且手机隐藏、提示改顶部 Toast。设计文档 `docs/superpowers/specs/2026-09-20-entry-points-design.md`，四个决策点待确认后实施。
- 2026-09-20：v0.14.0 完成实施顺序第 7 步，第四档 1 到 5 全部按推荐项落地，roadmap 所有实施项到此做完：
  - 第四档 1「设置中心」：图标栏底部新增「设置」（`data-view="settings"`），`SettingsDialog.vue` 改为分页大弹窗，四个分页拆成 `src/components/settings/AppearancePane.vue`、`DataPane.vue`（原 `BackupDialog.vue`，已删除）、`ShortcutsPane.vue`（原底栏「格式帮助」）、`AboutPane.vue`（原侧栏版本弹窗，页尾新增退出登录）。`stores/ui.ts` 的 `statsOpen` 泛化为 `overlay: 'stats' | 'settings' | null` 并新增 `settingsTab`、`trashRequest`；`navigation.ts` 的 `openStats / closeStats` 改为 `openOverlay(kind, tab?) / closeOverlay()`，旧快照的 `statsOpen` 字段兼容读取。快捷键 `Mod ,`。
  - 第四档 2「笔记『更多』菜单」：抽出 `ActionMenu.vue`（`GroupMenu.vue` 改为基于它），新增 `NoteMenu.vue` 与 `useMediaQuery.ts`；顶栏 `[data-op="more"]`，≤720px 时删除按钮让位并进菜单；`Mod Shift D` 改为 `ui.trashRequest` 计数由 `NoteDetail` 监听。
  - 第四档 3「底栏只做状态，提示改 Toast」：新增 `src/notify.ts` 与 `Toast.vue`；底栏桌面只显示状态与字数、≤720px 隐藏；`NoteDetail.vue` 删除 `flash` 与 `.share-notice`。
  - 第四档 4「历史版本独立弹窗」：新增 `HistoryDialog.vue`，`NoteInfoDialog.vue` 只留元数据。
  - 第四档 5「两处小补」：⋯ 菜单「打印 / 存为 PDF」；「关于」页「退出登录」。
  - `useDialogFocus` 增加最上层弹窗判断，两层弹窗叠加时 Esc 只关最上面那层。
- 2026-09-20：v0.15.0 按用户反馈做的入口收敛与云端历史：
  - 云端正文历史：新增 `shared/history-rules.ts`（`shouldSnapshot` 与阈值常量，本机 `src/db/history.ts` 与服务端共用）、迁移 `0004_note_history.sql`、`worker/db.ts` 的 `maybeRecordNoteHistory / recordNoteHistory / listNoteHistory`（`purgeNotes` 连带清理），PATCH 正文成功后留快照；接口 `GET/POST /api/notes/:id/history`。客户端 `fetchCloudHistory / mergeHistory / recordCloudSnapshot`，`HistoryDialog.vue` 合并显示并标来源，`restoreHistory` 改为按正文恢复。
  - 回收站保留提示：pull 响应新增 `trash_retention_days`，客户端存进 `ui.trashRetentionDays` 与 meta 表 `trash_retention_days`，`TrashView.vue` 顶部提示与每条「N 天后删除」。
  - 顶栏：桌面直接放 `wordcount / info / history` 三个 `data-op`，`NoteMenu` 新增 `showDocItems`（≤720px 才进菜单）；删除 `.editor-footer`。侧栏删除 `.version-button`。
  - 快捷键：新建改 `Mod Alt N`（`Mod N` 被浏览器抢），删除 `Mod Shift 0–9`。设置页删去多段说明文字。
  - 发布结果：提交 008c684、标签 v0.15.0 已推送；线上迁移 0004 已执行；Cloudflare Version ID 90b70a31-c61c-4854-afbd-f4b53e8a5e7c；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.15.0。
- 2026-09-21：v0.15.1 去掉历史版本弹窗顶部的规则说明文字。Cloudflare Version ID 6003c513-ebd4-47c6-8cfc-c0c9f858df2b；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.15.1。
- 2026-09-21：v0.15.2 修复导入备份重名分组重复（`importBackup` 的 `ensureGroup` 按名字复用）；回收站保留期默认 30 天（`parseTrashRetentionDays` 未设置时返回 `DEFAULT_TRASH_RETENTION_DAYS`），客户端 `trashDaysLeft` 未知时也按 30 天算，详情顶栏改为「此笔记还有 N 天被删除」，删除回收站顶部提示；回收站详情去掉字数、信息、历史与 ⋯；新建快捷键改 `Alt N`（按 `code` 兼容 Mac 死键）。
  - 发布结果：标签 v0.15.2；Cloudflare Version ID a442b6af-c48b-4687-b457-b757506497eb；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.15.2。
- 2026-09-21：v0.15.3 修复导入备份不同步：`POST /api/notes` 遇到 invalid=2 的墓碑改为复活（UPDATE 全字段、version/prop_version 各加一、note_body upsert），不再 `ON CONFLICT DO NOTHING` 后回报墓碑版本号。
  - 发布结果：标签 v0.15.3；Cloudflare Version ID f575223e-e7e4-43f7-9d28-a180ec35c9a4；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.15.3。
- 2026-09-21：v0.15.4 工具栏「插入表格」改为先弹 `TableDialog` 收行数与列数（默认 3×3，范围 1 到 20），再调用 `insertTable(row, col)`；此前固定插入 3×3。
  - 发布结果：标签 v0.15.4；Cloudflare Version ID ca0f5405-bf02-441d-97ef-a0f539ceeef5；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.15.4。
- 2026-09-21：v0.16.0 第五档 1 到 4 全部完成：接入 `tableBlock`（`src/editor/table-block.ts` 换项目图标，样式按 Crepe 主题用 opacity 隐藏把手，display:none 会让 floating-ui 定位错）；启用 `cursor` 与 `trailing`；`Settings.tableDensity` 三档落到 `--table-cell-padding`；`src/editor/highlight.ts` 用 `mdast-util-find-and-replace` 解析 `==文字==`、注册 toMarkdown handler 序列化、`markRule` 输入规则、`Mod-Shift-h`。编辑器分包 gzip 34KB → 57KB。
  - 发布结果：标签 v0.16.0；Cloudflare Version ID 7499b1f5-749d-4491-a43d-ac25d7de7350；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.16.0。
- 2026-09-24：v0.16.1 修复手机 PWA 缺少直接手动刷新入口的问题，笔记列表顶栏提供刷新按钮、忙碌状态与结果提示；HTML 转义保留 Markdown 自动链接，避免保存重开后网址被附加 `>`，打开链接时清理尾部空白并检查协议。
  - 验证：前端单测 647 项、Worker 测试 147 项、服务器测试 24 项通过；3 项浏览器回归覆盖 320px / 390px 手动刷新、离线提示和链接保存重开；类型检查与生产构建通过。线上 `/api/health` 返回正常，首页、Service Worker、主脚本、样式和编辑器脚本的 SHA256 均与本次构建一致，应用版本为 0.16.1。
  - 发布结果：提交 9949ae8；标签 v0.16.1；Cloudflare Version ID 217f6404-ea4e-49a7-bb05-dee3f60f8ee4（100% 流量）；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.16.1。
- 2026-10-11：v0.17.0 在笔记「更多操作」菜单的「下载 .md」旁新增「导入 .md」，单次读取一个文件，新建并打开笔记，保留原笔记；普通 Markdown 导入不再加载 ZIP 解压库。修复 VS Code 的 Markdown 剪贴板语言标记和单一 pre 包装导致整篇正文变成代码块的问题，取消历史 Markdown 代码块时重新解析标题、表格和文中代码块。
  - 验证：前端单测 659 项、Worker 测试 147 项、服务器测试 24 项全部通过；10 项浏览器回归覆盖 1440px / 320px 导入、Markdown 粘贴与代码块恢复、撤销重做、保存刷新、富文本编号及 1440px / 390px / 320px 更新提醒；类型检查与生产构建通过。另已使用用户提供的完整 Markflow 文档验证粘贴、保存及刷新。
  - 发布结果：提交 96c920d；标签 v0.17.0；Cloudflare Version ID 67048ded-713a-4738-a02a-888bcf2e4b3d（100% 流量）；正式站点 https://note.alover.me；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.17.0。
  - 上线核验限制：正式域名和 workers.dev 均启用 Cloudflare Access，当前未登录的验证会话被重定向到登录页，因此未完成线上 `/api/health` 与静态资源 SHA256 比对；部署成功及 100% 流量已通过 Wrangler 确认。
- 2026-10-14：v0.18.0 三块新增加两个修复。首页信息流可见性：`note.home_hidden`（三态：1 隐藏 / 0 强制显示 / NULL 跟随）与 `note_group.hide_from_home`，分组设默认、笔记可覆盖，侧栏新增「已隐藏」入口汇总，字段随笔记同步、备份包带上。阅读模式：顶栏书本按钮与 `Mod Shift E`，正文走 ProseMirror 原生只读，进入前先把编辑器里 debounce 中的内容落盘（`ui.readingRequest` 计数让快捷键与按钮走同一条路径），≤720px 时按钮让位给「⋯」菜单。统计页重做：KPI 卡 + 六个面板，删掉与热力图重复的 7 天图表和 `totalChars` 等未用字段，新增 `hidden` 计数。打开次数修复三处：只有 `notes.open()` 这条主动打开路径计数（启动自动选中、切视图补选、新建跳转、返回恢复位置不再计）；新增 `want` 点名查询，补齐本设备首次见到某条笔记时早已落在游标之前的其它设备计数，服务端对没有记录的笔记明确回 0；文档信息弹窗改为显示本机 + 其它设备的合计。另修复切换笔记后按撤销会把上一条笔记正文倒回当前笔记并落库的问题（`resetHistory` 重建 EditorState 清空跨文档的 history）。数据库迁移 0005（`ALTER TABLE note` / `note_group`）。
  - 验证：前端单测 688 项（50 文件）、Worker 测试 155 项、服务器测试 24 项全部通过；浏览器回归 49 项（约 4.9 分钟）覆盖 1440px / 1020px / 720px / 390px / 320px 的统计弹窗、320px 顶栏溢出、阅读模式、首页信息流开关、打开榜跳转、撤销不跨笔记，以及原有全部编辑器与同步用例；类型检查与生产构建通过。
  - 发布结果：提交 ecf3254（功能）与 9a3474c（版本）；标签 v0.18.0；Cloudflare Version ID 205005ca-0458-486d-84c7-66202cdb648f（100% 流量）；生产 D1 已应用迁移 0005_home_feed.sql；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.18.0。
  - 上线核验限制：正式域名和 workers.dev 均在 Cloudflare Access 后面，未登录会话被重定向到登录页，因此未完成线上 `/api/health` 与静态资源比对；部署成功、迁移结果与 100% 流量均已通过 Wrangler 确认。
- 2026-10-14：v0.19.0 个人知识库 P0 已本地提交并部署。独立首页与章节目录、已有笔记引用及库内新建、移动排序与库内搜索、离线同步及冲突快照、移除与恢复、备份格式 2；不包含权限管理和协作功能。使用与升级说明见 [knowledge-bases.md](knowledge-bases.md)。
  - 验证：本次上线前 `npm run test:all` 共 899 项通过（客户端/领域 706、Worker 162、Node/SQLite 31），`npm run build` 与部署中的再次构建通过。开发阶段另有 Node 浏览器全量 54 项及 Cloudflare 本地知识库浏览器 5 项通过。
  - 部署结果：本地发布提交 `d51aa83`；本地标签 `v0.19.0`；生产 D1 已应用 `0006_knowledge_bases.sql`，复查无待执行迁移；Cloudflare Version ID `94b720a4-43fe-4d98-9f5a-51b733b12dab`，经 `wrangler deployments list` 确认承接 100% 流量；正式站点 https://note.alover.me。
  - 用户明确要求不 push：本次没有推送提交或标签，也没有创建 GitHub Release，远端发布记录尚未包含此版本。
  - 上线核验限制：正式域名的首页及 `/api/health` 均返回 302 至 Cloudflare Access；未登录验证会话无法完成线上界面、健康响应或静态资源比对。workers.dev 的本次 HTTP 检查发生连接超时。未绕过访问控制；部署和数据库结果已通过 Wrangler 核实。
- 2026-10-15：v0.20.0 统一笔记与知识库工作区。侧栏支持收起和分区折叠，已隐藏笔记直接访问，底部工具位于同步状态上方；搜索与排序同行，知识库恢复卡片网格和基本信息首页，顶部新建默认根目录、章节菜单提供就地创建。统一动画和表单聚焦，修复拖选文字误关弹窗及菜单抢焦点。
  - 验证：发布前 `npm run test:all` 全部通过（客户端/领域 714、Worker 162、Node/SQLite 31，共 907 项），`npm run build` 与部署构建通过；开发阶段 Node 浏览器全量回归 62 项通过，覆盖桌面与 320px 等窄屏、目录创建位置、排序、表单拖选和键盘焦点。生产 D1 复查无待执行迁移，本版本不新增迁移。
  - 发布结果：发布提交 `255321a`、标签 `v0.20.0` 已推送到 origin；此前仅保留在本地的 v0.19.0 提交和标签也已一并推送。Cloudflare Version ID `15fc753f-9141-4230-9e9e-f8107178281f`，经 `wrangler deployments list` 确认承接 100% 流量；正式站点 https://note.alover.me；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.20.0，标记为 Latest 稳定版。
  - 上线核验限制：正式域名首页和 `/api/health` 返回 302 至 Cloudflare Access 登录页，workers.dev 的 HTTP 请求连接失败；当前未登录会话未完成线上页面、健康响应及静态资源比对。部署成功、绑定及 100% 流量已通过 Wrangler 核实。
- 2026-10-15：v0.21.0 统一「笔记本」口径，精简侧栏并调整中性配色；统计、设置改为独立工作区页面，热力图单独占一行，外观新增列表密度、摘要显隐与正文行距。设置分页及内容居中，说明收进信息图标，快捷键两列围绕中轴对称并各自左对齐，关于页通过服务端查询实际部署方式。删除笔记本需联网输入完整名称确认，永久删除引用的笔记、图片和历史，跨设备清理并防止迟到请求恢复内容。
  - 验证：`npm run test:all` 全部通过（客户端/领域 722、Worker 165、Node/SQLite 34，共 921 项）；Node 浏览器全量回归 62 项、Cloudflare 本地关键浏览器回归 10 项通过。类型检查、`npm run build` 与部署构建通过；1440/390/320px 的快捷键对称布局、信息提示边界与登录区位置另经浏览器复核。
  - 生产数据：迁移前 D1 SQL 备份保存在部署机 `backups/pre-v0.21.0-20261015.sql`（SHA256 `3BB7C8968A138C3E7FE315DEAC9937FAA81F0BD8B13C64F3483512650EC73245`）；生产迁移 `0007_permanent_notebook_deletion.sql` 已成功应用，复查无待执行迁移。备份未纳入 Git。
  - 发布结果：功能分拆提交 `1e7cdee`（服务端接口与迁移）、`e1e7e5b`（同步及备份）、`6095421`（界面与交互）；发布提交 `59a1dc6`、标签 `v0.21.0` 已推送。Cloudflare Version ID `fba5d2fd-8131-4c21-b0c5-58238da64560`，经 `wrangler deployments list` 确认承接 100% 流量；正式站点 https://note.alover.me；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.21.0，已核对为 Latest 稳定版。
  - 上线核验限制：正式域名首页和 `/api/health` 返回 302 至 Cloudflare Access 登录页；workers.dev 的健康检查请求连接超时。当前未登录会话未完成线上页面、健康响应及静态资源比对；部署成功、绑定、迁移及 100% 流量已通过 Wrangler 核实。
- 2026-10-15：v0.22.0 完成全项目主要数据链路与界面审查，按确认缺陷修复并发布。笔记本笔记独立于外部列表和统计，新加入操作校验唯一归属；目录删除进入回收站，保留原笔记本、章节与排序，恢复后不会泄漏到外部信息流。设置快捷键两列内容各自居中，导航「记录统计」改为「统计」。历史共享数据保留，不静默删除。
  - 主要修复：正文/属性并发 CAS 原子性、删除/恢复属性版本递增、延迟提交及应用时钟回拨漏增量同步、服务器登录限流绕过、过期目录删除确认、离线加入笔记本后的旧列表、图片上传跨文档与未保存文字丢失、备份外链路径与重复导入误冲突、浏览器前进和过期统计跳转。真实浏览器测试另发现并修复 Milkdown 生命周期读取 Vue 代理对象私有字段的兼容回归，单测夹具也改用代理实例。
  - 验证：最终 `npm run test:all` 961 项全部通过（客户端/领域 748、Worker 171、Node/SQLite 42）；Cloudflare 本地与 Node 两套浏览器全量回归各 63 项通过，共 126 项，覆盖 1440/720/390/320px、离线同步、多设备冲突、目录删除原位恢复及插图。前后端独立类型检查、Web/Node 生产构建及部署再次构建全部通过。
  - 生产数据：迁移前 SQL 备份保存在部署机 `backups/pre-v0.22.0-20261015.sql`（SHA256 `5A6C745F4AF40330F8148659BA09797F9F1259735B131B259D0EB4B18F6E0C64`），未纳入 Git。`0008_commit_ordered_sync.sql` 已成功应用，复查无待执行迁移；生产只读查询核实四个同步触发器及提交水位均已就绪，未改写现有正文。
  - 发布结果：功能与修复分成七个提交，发布提交 `f26ded7`（`chore(release): v0.22.0`）与注解标签 `v0.22.0` 已推送；保留并合入远端 README 新提交 `c7293f4`，未强推覆盖。Cloudflare Version ID `ac9bb67c-63ea-4475-8464-25f41c58e471`，经 `wrangler deployments list` 确认承接 100% 流量；正式站点 https://note.alover.me；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.22.0，已核对为 Latest 稳定版。
  - 上线核验限制：本次正式域名 `/api/health` 返回 302 至 Cloudflare Access，首页与 workers.dev 健康请求连接超时；未绕过访问控制，因此未完成经过登录的线上页面、健康响应与静态资源比对。部署、生产数据库迁移与 100% 流量已通过 Wrangler 确认；不以本轮测试宣称项目绝对没有其他缺陷。
- 2026-10-15：v0.22.1 修复回收站及已彻底删除笔记在笔记本目录中残留占位、再次删除无法清理引用的问题，保留可恢复笔记的原章节位置并修正计数。首页改为封面与四项信息格，标签在左、加粗数值在右，窄屏自动单列。中英文 README 精简为项目介绍与快速开始，完整使用、开发及部署指南迁入文档目录。
  - 验证：`npm run test:all` 965 项通过（客户端/领域 752、Worker 171、Node/SQLite 42）；Cloudflare 本地全量浏览器回归 63 项、Node.js 笔记本与首页回归 7 项通过。类型检查、Web/Node 生产构建和部署构建通过；10 份文档的 99 个本地链接与锚点检查通过。没有新增数据库迁移，已确认生产无待执行迁移。
  - 提交：`69cd7aa`（删除与恢复修复）、`13a60c3`（首页布局）、`4a37b2d`（文档整理）、`09551d4`（`chore(release): v0.22.1`）；提交及注解标签 `v0.22.1` 已推送。无关演示页 `1.html` 与历史设计产物 `output/` 保留本地，未纳入发布。
  - 发布结果：Cloudflare Version ID `970bed0a-5265-4f35-8a39-43d7828f6d0c`，Deployment ID `3db3a047-f70c-4c10-9669-ea0636f99be2`；经 Wrangler 确认承接 100% 流量。正式站点 https://note.alover.me；GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.22.1，已核对为 Latest 稳定版。
  - 上线核验限制：正式域名首页和 `/api/health` 返回 302 至 Cloudflare Access 登录页，workers.dev 健康请求连接失败。本次未完成登录后的线上页面、健康响应与静态资源比对；部署和流量状态已通过 Cloudflare 确认。

- 2026-10-16：v0.22.2 根据前端审阅精简编辑器与目录工具栏，保持隐藏/分组操作中的编辑上下文，列表增加快捷整理和软删除撤销，笔记本支持移出为独立笔记、最近更新入口与精确拖拽提示；修复快速返回时最后输入未落盘的问题。同步更新中英文 README、使用与部署指南，合入目录快照入口清理并保留冲突及旧备份兼容。
  - 验证：`npm run test:all` 共 974 项通过（客户端/领域 759、Worker 172、Node/SQLite 43）；Cloudflare 本地浏览器 67 个用例分批全部通过（核心流程 41、其余流程 25、折叠分组入口 1），覆盖 1440/720/390/320px、双设备冲突、离线与删除恢复。`npm run build` 与部署前类型检查通过；7 份更新文档的 62 个本地文件链接有效。无新增迁移，已确认生产没有待执行迁移。
  - 提交与发布：`2104450`（`chore(release): v0.22.2`）及注解标签 `v0.22.2` 已推送；中英文 README 与安装命令均更新到本次稳定版。无关的 `pelican-bike.html` 本地删除、`1.html` 和 `output/` 未纳入提交。
  - 部署结果：`npm run deploy -- --message 'Release v0.22.2'` 成功；Cloudflare Version ID `9f6693d3-3509-4390-a6ba-f3ee2bae82f4`，Deployment ID `85f20a5a-8cee-49f3-bf85-749fd65720de`；`wrangler deployments list` 确认该版本承接 100% 流量。GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.22.2，已核对为 Latest 正式稳定版。
  - 线上核验范围：正式站点 https://note.alover.me 的 `/api/health` 通过 curl 检查返回 302 至 Cloudflare Access 登录页；当前环境无法完成登录后的线上页面与健康响应检查。生产部署与流量已通过 Cloudflare 核实，本地完整 Worker 浏览器回归通过。

- 2026-10-16：v0.22.3 调整笔记本总览卡片的图标、标题、操作区与悬停反馈，精简笔记本首页，移除最近更新笔记和目录速览区块，统一从左侧目录进入笔记与章节。
  - 验证：`npm run test:all` 共 974 项通过（客户端/领域 759、Worker 172、Node/SQLite 43）；Cloudflare 本地浏览器针对 `workspace.spec.ts` 与 `ux-review.spec.ts` 的 12 项用例全部通过，覆盖 1440/720/390/320px、目录打开与移出笔记本、编辑保留、删除撤销及基本信息首页。`npm run build` 和部署构建通过；无新增迁移，生产 D1 已确认没有待执行迁移。
  - 提交与发布：`ad0e6ad`（`chore(release): v0.22.3`）及注解标签 `v0.22.3` 已推送；中英文 README 和服务器安装命令已更新到本次稳定版。GitHub Release https://github.com/xilele777/snotes/releases/tag/v0.22.3，已核对为 Latest 正式稳定版。
  - 部署结果：`npm run deploy -- --message 'Release v0.22.3'` 成功；Cloudflare Version ID `50f7706d-155b-403b-bfd9-029a919c995c`，Deployment ID `b4d1a2b0-a6b2-4e8e-b9ce-69e42cdc5a04`，经 Wrangler 确认承接 100% 生产流量。
  - 清理：提交删除无关演示页 `pelican-bike.html`，将旧截图、预览、临时脚本、日志和测试报告共 415 个文件（约 13.04 MiB）移入回收站。保留环境配置、数据库、备份、依赖、构建目录和本地状态目录；本次发布验证日志保留在 `tmp/`。本地前端和 Worker 已启动，页面及代理健康检查均返回 200。
  - 线上核验范围：正式站点 https://note.alover.me 的 `/api/health` 返回 302 至 Cloudflare Access 登录页，未完成登录后的线上页面和健康响应检查；生产部署及 100% 流量已通过 Cloudflare 核实。
