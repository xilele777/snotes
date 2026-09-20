# 入口与呈现方式整理设计

- 日期：2026-09-20
- 基线：v0.13.0，main 分支 6221bbe
- 状态：已按推荐项实施，v0.14.0 发布
- 范围：只调整已有功能的入口、承载容器与提示方式。不改数据模型、同步协议、服务端与列表页

## 1. 背景

roadmap 六步做完后功能是齐的，但入口是「哪里有空就放哪里」长出来的：

- 侧栏底部一行挤着同步状态、版本号、导出导入、设置四样东西。后两个是 28px 的无文字图标，手机上要先开抽屉，再到角落里找。
- 编辑器底栏承担了字数、文档信息（含历史版本）、导出分享、格式帮助四个入口。底栏贴着屏幕底边，手机浏览器的地址栏或工具栏、系统手势区、软键盘都在这一带，经常点不准或点不到；文字 11px、按钮 28px 高，也低于触控目标下限。
- 本地正文历史藏在「文档信息」弹窗里。需要它的人是刚误删了一段的人，不会想到去点 ⓘ。
- 快捷键清单和 Markdown 速查放在底栏的「格式帮助」弹层里。前者是桌面用户的事，后者在有了格式工具栏之后价值下降，两者都不该占手机底栏。
- 打印只有 Ctrl/⌘ P，手机没有快捷键。令牌没有退出入口，只能清浏览器存储。

用户性质：个人便签。手机随手记、电脑整理，PWA 安装到主屏。手机上的高频动作是打字、撤销、插图、返回；星标、置顶、颜色、移动分组是中频；删除、导出、信息、统计是低频。桌面有鼠标和键盘，可以多放几个直接可见的按钮。

### 1.1 现状盘点

| 功能 | 当前入口 | 问题 |
| --- | --- | --- |
| 主题 / 字号 / 编辑区宽度 | 侧栏底部 28px 齿轮图标 → 设置弹窗 | 无文字、与同步 / 版本 / 备份挤一行，手机上要先开抽屉 |
| 导出与导入 | 侧栏底部 28px 下载图标 → 备份弹窗 | 同上；下载图标像「下载」不像「备份」 |
| 版本与更新 | 侧栏底部版本号按钮 → 版本弹窗 | 可用，但升级步骤这类内容更适合放在「关于」 |
| 单条复制 / 下载 / 分享 | 底栏分享图标 → 向上弹出 popover | 被浏览器底栏、手势区、键盘遮挡；目标过小 |
| 文档信息 + 历史版本 | 底栏 ⓘ → 弹窗 | 同上；历史版本藏在「信息」里找不到 |
| 字数统计 | 底栏「N 字」按钮 → 弹窗 | 同上 |
| Markdown 速查 + 快捷键清单 | 底栏「格式帮助」→ 252px 宽 popover | 同上；内容与手机无关 |
| 打印 | 无入口，仅 Ctrl/⌘ P | 手机没有快捷键 |
| 退出登录 | 无入口 | 只能清浏览器存储 |
| 分组菜单、格式工具栏、链接气泡、图片灯箱、搜索多词、PWA 分享目标 | 各自就地 | 合适，不动 |

## 2. 目标与非目标

目标：

1. 应用级、低频的东西归到一个「设置」里。一个入口，手机上带文字标签。
2. 笔记级、低频的操作归到顶栏一个「更多」菜单。桌面和手机同一套条目。
3. 底栏不再放任何可点的东西。提示改成 Toast，不依赖屏幕底边。
4. 手机 320px 顶栏不撑宽，格式工具栏「完整可见」的 E2E 约束不变。

非目标：

- 不改数据、同步、服务端。
- 不加新功能。存储用量汇总、手动检查更新、图片分享目标仍留在 roadmap 可选项。
- 不动列表页、统计弹窗、分组菜单、编辑器内交互。

## 3. 总体方案

三条主线加两处小补：

1. **设置中心**：图标栏新增「设置」，打开一个分页大弹窗（外观 / 数据 / 快捷键 / 关于），收拢主题字号宽度、导出导入、快捷键与速查、版本更新、退出登录。
2. **笔记「更多」菜单**：顶栏最右加 ⋯，收拢文档信息、历史版本、字数、复制、下载、分享、打印；手机上删除也并进去。
3. **底栏只做状态**：桌面显示「自动保存 · N 字」，手机整条隐藏；所有提示改走顶部 Toast。
4. 小补一：历史版本从文档信息里拆出，成为独立菜单项与弹窗。
5. 小补二：打印与退出登录各加一个入口。

桌面布局示意（1440px）：

```text
┌──┬──────────────┬────────────────────┬─────────────────────────────────────────────┐
│笔│ snotes       │ 全部笔记    新建   │ [📁 工作 ▾]        ↶ ↷ 🖼 │ 📌 ☆ ● │ ⛶ 🗑 ⋯  │
│记│ 全部笔记  12 │ ─────────────────  │ H1 H2 H3 │ B I S <> ≡ 1. ☑ ❝ {} │ 🔗 ▦     │
│  │ 星标笔记     │ 搜索…              │                                             │
│统│ 回收站       │                    │  正文                                       │
│计│ 分组      +  │ ▪ 笔记 A           │                                             │
│  │  📁 工作     │ ▪ 笔记 B           │                                             │
│  │  📁 生活     │                    │                                             │
│  │              │                    │                                             │
│设│ ☁ 自动同步   │                    │                                             │
│置│      v0.14.0 │                    │ ● 自动保存 · 128 字                         │
└──┴──────────────┴────────────────────┴─────────────────────────────────────────────┘
```

手机编辑页示意（390px）：

```text
┌──────────────────────────────────┐
│ ←  📁   ↶ ↷ 🖼 │ 📌 ☆ ● │ ⋯     │
│ H1 H2 H3 │ B I S <> ≡ 1. ☑ ❝ … → │
│                                  │
│  正文                            │
│                                  │
│                                  │
│           (无底栏)               │
└──────────────────────────────────┘
```

## 4. 详细设计

### 4.1 图标栏与侧栏

- 图标栏（`.app-rail`）新增「设置」按钮，`margin-top: auto` 放在栏底，与「笔记」「统计」同款：桌面只有图标，≤1020px 的抽屉里显示文字标签「设置」。图标沿用 `sliders`。`aria-haspopup="dialog"`，`data-view="settings"`。
- 有新版本时，「设置」按钮右上角显示与版本号同款的蓝点，和版本号按钮的 `has-update` 用同一个 computed。
- 侧栏底部 `.user-area` 只保留同步状态按钮和版本号。版本号点击打开设置的「关于」页。类名 `.version-button` 与蓝点保持，`update-notice.spec.ts` 依赖它。
- 删除 `.backup-button`、`.settings-button`，以及侧栏里的版本弹窗 Teleport 与其键盘处理（约 60 行）。`GroupSidebar.vue` 只剩导航与分组。
- 删除 `BackupDialog.vue`，内容并入设置「数据」页。

选图标栏而不是侧栏列表项的理由：设置是应用级的，与「统计」同级，不与「全部笔记 / 星标 / 回收站」这些筛选项混在一起；图标栏在抽屉里本来就带文字标签，手机上能看见「设置」两个字。

### 4.2 设置弹窗

**容器**：沿用统计弹窗的壳（`dialog-mask` + 大弹窗 + 头部标题与关闭钮）。`SettingsDialog.vue` 改为分页结构，挂在 `App.vue`，不再挂在侧栏。

**尺寸**：桌面 `width: 720px; height: min(560px, calc(100dvh - 80px))`，左侧 160px 分页列，右侧内容区独立滚动。≤720px 与统计弹窗一致占满屏（12px 外边距加安全区），分页改为头部下方的横向标签条，四个标签在 320px 内放得下（每个约 70px）。

**分页与内容**：

| 分页 | 内容 | 迁自 |
| --- | --- | --- |
| 外观 | 主题、正文字号、编辑区宽度三组单选；「只保存在当前设备」提示 | 现有 `SettingsDialog.vue` |
| 数据 | 「导出全部」「导入备份」按钮、zip 结构说明、进度条与结果文案；新增一段「本机数据」说明：历史版本只存在本设备，不同步、不导出 | `BackupDialog.vue` |
| 快捷键 | 全局快捷键清单（`SHORTCUT_LIST`，新增 `Mod ,` 打开设置）；编辑器内快捷键（Ctrl+Z / Y，Mod 加点击打开链接，灯箱 ← → + - 0 Esc）；Markdown 速查（`# 空格` 等五条） | `NoteDetail.vue` 格式帮助 |
| 关于 | 应用名、网页版本、最新版本与升级步骤（按部署目标区分 Cloudflare 与服务器）、「查看发布说明 / 全部版本」链接；页尾「退出登录」按钮 | `GroupSidebar.vue` 版本弹窗；退出登录为新增 |

**组件拆分**：`SettingsDialog.vue` 只负责壳、分页与导航；四个分页各自成组件放在 `src/components/settings/`：`AppearancePane.vue`、`DataPane.vue`、`ShortcutsPane.vue`、`AboutPane.vue`。每个 pane 只依赖自己的模块（`settings.ts`、`export/backup.ts`、`shortcut.ts`、`update-check.ts`）。

**打开方式**：图标栏「设置」打开外观页；版本号打开关于页；快捷键 `Mod ,` 打开外观页。不记忆上次停留的分页。

**导航**：`ui.statsOpen` 泛化为 `ui.overlay: 'stats' | 'settings' | null`，另加 `ui.settingsTab`。`navigation.ts` 的 `openStats / closeStats` 改为 `openOverlay(kind, tab?) / closeOverlay()`，行为与统计一致：打开前 `pushNav`，系统返回或关闭按钮都回到原工作区。快照字段由 `statsOpen` 改为 `overlay`，`restore` 兼容旧条目：`s.overlay ?? (s.statsOpen ? 'stats' : null)`。`App.vue` 的 `:inert` 与键盘守卫改看 `ui.overlay`。

**无障碍**：分页用 `role="tablist" / "tab" / "tabpanel"`，← → 切换；焦点管理沿用 `useDialogFocus`；关闭后焦点回到触发按钮（图标栏「设置」或版本号），与统计弹窗的 `returnFocus` 写法一致。

**退出登录**：`ConfirmDialog` 文案「退出后需要重新输入访问令牌，本机已同步的笔记会保留。」确认后先 `closeOverlay()`，再 `clearToken()`，界面回到令牌页。只清令牌，不动 IndexedDB。

### 4.3 顶栏与「更多」菜单

桌面顶栏：`[分组位置] …… 撤销 重做 插图 | 置顶 星标 颜色 | 专注 删除 ⋯`。

手机顶栏（≤720px）：`← [分组] 撤销 重做 插图 | 置顶 星标 颜色 | ⋯`。删除并入菜单。

**320px 预算**：按 ≤720px 的样式表合计，顶栏内容是左内边距 8 + 返回 32 + 间距 4 + 分组 32 + 间距 4 + 操作条 240（7 个 30px 按钮、2 条 7px 分隔、8 个 2px 间距）+ 右内边距 12 = 332px，已超出 320，目前靠 `min-width: 0` 的分组按钮和返回按钮被压缩才放下；操作条本身 `flex: none` 不缩，E2E「320px 下编辑工具栏完整可见」断言的 `x + width <= 320` 卡的正是它。去掉分隔线或把按钮缩到 28px 都省不出一个 30px 位子，所以手机上加 ⋯ 必须换掉一个按钮。换掉的是删除：低频、列表左滑已有兜底、且常驻在星标旁边容易误触。

**菜单条目**：

| 条目 | 编辑态 | 只读态（回收站） | 动作 |
| --- | --- | --- | --- |
| 文档信息 | ✓ | ✓ | 打开 `NoteInfoDialog` |
| 历史版本 | ✓ | ✓（只能预览） | 打开 `HistoryDialog` |
| 字数统计 | ✓ | ✓ | 打开 `WordCountDialog` |
| 复制 Markdown | ✓ | ✓ | `copyMarkdown` |
| 下载 .md | ✓ | ✓ | `downloadMarkdown` |
| 分享到其他应用 | 仅 `navigator.share` 可用时 | 否 | `shareMarkdown` |
| 打印 / 存为 PDF | ✓ | ✓ | `window.print()` |
| 删除 | 仅 ≤720px，红色 | 否 | 打开现有确认弹窗 |

前三条与后四条之间、删除之前各一条分隔线。只读态的恢复与彻底删除仍是顶栏可见按钮，不进菜单。

**实现**：

- 抽 `ActionMenu.vue`：从 `GroupMenu.vue` 把 Teleport 到 body、fixed 定位与翻转、方向键循环、Esc 与 Tab 关闭、外点关闭、关闭后焦点归还这一套抽出来，条目通过默认插槽传入。`GroupMenu.vue` 改为基于它，行为不变。
- 新增 `NoteMenu.vue` 渲染上表条目，props：`anchor`、`readonly`、`canShare`、`showDelete`；每个条目 emit 一个动作名，由 `NoteDetail.vue` 分发。触屏（`hover: none`）下条目最小高度 44px。
- ⋯ 按钮 `data-op="more"`，`aria-haspopup="menu"`，`aria-expanded` 跟随菜单开合。
- 是否显示删除由 `useMediaQuery('(max-width: 720px)')` 决定，新增这个小 composable 放在 `src/components/`，`App.vue` 的 `compact` 也改用它。
- 删除快捷键 `Mod Shift D` 不再去点 `[data-op="trash"]`（手机上它在菜单里）。`ui` store 加 `trashRequest` 自增计数，`App.vue` 的 `runShortcut` 自增它，`NoteDetail.vue` watch 到变化就打开确认弹窗。

### 4.4 底栏与 Toast

**底栏**只显示状态，没有任何按钮：

- 桌面：`● 自动保存 · 128 字`，只读态 `🔒 只读 · 128 字`。字数由现有 `wordCount` computed 实时更新。
- ≤720px：整条隐藏。`.editor-body .ProseMirror` 的 `min-height` 公式里把底栏那项 40px 去掉，否则短内容会多出一截空白滚动。

**Toast**：

- 新增 `src/notify.ts`：`notify(text)`，只保留当前一条，新消息替换旧消息，3.5 秒自动消失；导出 `notice` ref 供组件渲染与测试断言。
- 新增 `Toast.vue` 挂在 `App.vue`：顶部居中，`top: calc(12px + env(safe-area-inset-top))`，`role="status"`，`pointer-events: none`，`max-width: min(360px, calc(100vw - 32px))`。选顶部是因为底部正是被浏览器工具栏和键盘遮住的区域。`prefers-reduced-motion` 下不做动画。
- `NoteDetail.vue` 删除 `flash`、`shareNotice`、`.share-notice`。复制、下载、分享、恢复历史、链接气泡的「已复制链接」全部改走 `notify`。编辑器仍通过 `emit('notice')` 上报，由 `NoteDetail` 转给 `notify`。
- 打印样式追加隐藏 `.toast` 与 `.action-menu`。

### 4.5 历史版本独立弹窗

`NoteInfoDialog.vue` 只保留元数据五行。历史列表、预览与恢复拆成 `HistoryDialog.vue`，props：`open`、`note`、`readonly`；emit `close`、`restore`。加载时机（打开或 `update_time` 变化时重读）、空态文案、只读态无恢复按钮都与现在一致。弹窗标题「历史版本」，副标题「只保存在本设备，改动间隔满 5 分钟或一次改动较大时自动留存」。

### 4.6 对 roadmap 的两处偏离

- **打印**：roadmap 写「不加打印按钮，浏览器快捷键即可」。这里在 ⋯ 菜单里加一条，理由是手机没有 Ctrl/⌘ P；菜单项不占顶栏空间，桌面用户仍可用快捷键。
- **退出登录**：不在 roadmap 里。有了「关于」页之后没有退出入口显得残缺，且目前唯一办法是清浏览器存储。只清令牌，不动本地数据。

## 5. 动作与入口一览

| 动作 | 桌面 | 手机（≤720px） |
| --- | --- | --- |
| 主题 / 字号 / 宽度 | 图标栏「设置」→ 外观 | 抽屉 → 图标栏「设置」→ 外观 |
| 导出 / 导入 | 设置 → 数据 | 同左 |
| 快捷键与速查 | 设置 → 快捷键 | 同左（照常显示） |
| 版本与升级 | 版本号 或 设置 → 关于 | 同左 |
| 退出登录 | 设置 → 关于 页尾 | 同左 |
| 文档信息 / 历史版本 / 字数 | 顶栏 ⋯ | 顶栏 ⋯ |
| 复制 / 下载 / 分享 / 打印 | 顶栏 ⋯ | 顶栏 ⋯ |
| 删除笔记 | 顶栏 🗑 或 `Mod Shift D` | 顶栏 ⋯ → 删除，或列表左滑 |
| 保存状态与字数 | 底栏只读文字 | 不显示 |
| 操作提示 | 顶部 Toast | 顶部 Toast |

## 6. 文件变更清单

新增：

- `src/components/ActionMenu.vue`：通用浮层菜单壳。
- `src/components/NoteMenu.vue`：笔记「更多」菜单条目。
- `src/components/HistoryDialog.vue`：历史版本弹窗。
- `src/components/Toast.vue`、`src/notify.ts`：全局提示。
- `src/components/settings/AppearancePane.vue`、`DataPane.vue`、`ShortcutsPane.vue`、`AboutPane.vue`。
- `src/components/useMediaQuery.ts`。

修改：

- `src/App.vue`：挂 `SettingsDialog`、`Toast`；`compact` 改用 `useMediaQuery`；`inert` 与键盘守卫改看 `ui.overlay`；`Mod ,` 与 `trashRequest`。
- `src/components/GroupSidebar.vue`：图标栏加「设置」；`user-area` 去掉两个图标钮；移除版本弹窗与 `BackupDialog` / `SettingsDialog` 引用。
- `src/components/SettingsDialog.vue`：改为分页大弹窗。
- `src/components/NoteDetail.vue`：顶栏加 ⋯；底栏改纯状态；删除 `openPop` 里的 `help` 与 `share`、`flash`、格式帮助 popover；接入 `NoteMenu`、`HistoryDialog`、`notify`。
- `src/components/NoteInfoDialog.vue`：去掉历史区块。
- `src/components/GroupMenu.vue`：改为基于 `ActionMenu`。
- `src/components/shortcut.ts`：新增 `openSettings` 动作（`Mod ,`）与清单条目。
- `src/stores/ui.ts`：`statsOpen` → `overlay`，新增 `settingsTab`、`trashRequest`。
- `src/navigation.ts`：`openStats / closeStats` → `openOverlay / closeOverlay`，快照字段与兼容读取。
- `src/components/StatsDialog.vue`：改用 `closeOverlay`。
- `src/styles.css`：图标栏底部按钮、设置弹窗分页布局、`.action-menu`、`.toast`、底栏纯状态样式、≤720px 隐藏底栏与正文高度、打印隐藏项。

删除：

- `src/components/BackupDialog.vue`。

## 7. 测试计划

单元测试（vitest）：

- `ActionMenu.test.ts`：定位翻转、方向键循环、Esc / Tab / 外点关闭、焦点归还。
- `NoteMenu` 经 `NoteDetail.test.ts` 覆盖：桌面不含删除、≤720px 含删除；各条目打开对应弹窗或调用导出函数；只读态条目集合；`navigator.share` 缺失时无分享项。
- `SettingsDialog.test.ts`：四个分页渲染与切换、← → 切换、按指定分页打开、Esc 关闭、关闭后焦点归还；数据页导出导入沿用原 `BackupDialog` 的断言；关于页退出登录走确认并清令牌。
- `notify.test.ts`：替换与自动消失（用 `vi.useFakeTimers`，此模块不碰 Dexie）。
- `HistoryDialog.test.ts`：从 `NoteDetail.test.ts` 的历史版本用例迁出。
- `GroupSidebar.test.ts`：图标栏「设置」存在且有蓝点；`user-area` 不再有备份与设置钮；版本号打开关于页。
- `navigation.test.ts`：`openOverlay('settings')` 入栈、系统返回关闭、旧快照 `statsOpen` 兼容。
- `shortcut.test.ts`：`Mod ,`。
- `App.test.ts`：`Mod Shift D` 自增 `trashRequest`。

E2E（Playwright）：

- `full-flow.spec.ts` 320px 用例：`[data-op="trash"]` 改为打开 ⋯ 后断言「删除」条目可见且菜单在 320 内；保留格式工具栏与 `scrollWidth === 320` 断言；新增断言底栏不可见。
- `settings.spec.ts`：入口仍按名称「设置」定位（现在是图标栏按钮）；增加切到「数据」页点导出得到下载的断言。
- `update-notice.spec.ts`：点版本号后断言设置弹窗处于「关于」页且有「查看发布说明」链接，Esc 后焦点回到版本号。

真机检查：vite dev 加 Playwright 脚本在 1280、390、320 三档截图，确认 ⋯ 菜单、设置分页、Toast 均不溢出；截图放 `tmp/`，不入库。

## 8. 文档更新

实施完成后同步：

- `README.md`「界面与操作」表：「侧栏底部『设置』」改为「图标栏『设置』」；「正文底部」一行改为「顶栏『⋯』」并列出条目；补「退出登录」。
- `CHANGELOG.md`：0.14.0，按「变更」而非「新增」描述入口迁移，注明手机上删除移入菜单、底栏不再有按钮、打印与退出登录两处新增。
- `docs/ui-refresh.md`：新增「入口整理（2026-09-20）」一节，替换「底部文档信息保持直接可用」的描述。
- `docs/roadmap.md`：第四档状态与更新记录。
- `docs/进度.md`：本次发布内容、关键实现位置、验证状态。

## 9. 决策点

以下四处已按推荐项写入上文，可推翻：

1. **手机底栏**：推荐整条隐藏，把空间还给正文。备选：保留一条 28px 的纯文字状态条（无按钮），代价是仍然贴在被遮挡的位置。
2. **手机顶栏让位给 ⋯ 的按钮**：推荐删除。备选：重做（撤销 / 重做拆开不成对），或颜色（便签的标志性功能，中频）。
3. **两处偏离 roadmap 的小项**：推荐纳入打印与退出登录。备选：只做入口迁移，两项另开 PATCH。
4. **设置入口位置**：推荐图标栏底部。备选：侧栏视图列表末尾加一行「设置」，代价是与筛选项混排、抽屉里位置更深。

## 10. 实施顺序

一次发布 v0.14.0，按依赖从底向上：

1. `useMediaQuery`、`notify` + `Toast`、`ActionMenu`（含 `GroupMenu` 改造），三者互不依赖。
2. `HistoryDialog` 拆出，`NoteInfoDialog` 瘦身。
3. `NoteMenu` + 顶栏 ⋯ + 底栏纯状态 + `trashRequest`。
4. `ui.overlay` 与 `navigation.ts` 改造，`StatsDialog` 跟随。
5. `SettingsDialog` 分页与四个 pane，`BackupDialog` 删除。
6. 图标栏「设置」、`user-area` 收拢、版本弹窗迁走、`Mod ,`。
7. 单测、E2E、三档截图、文档、发布。
