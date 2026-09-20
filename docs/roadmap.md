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
