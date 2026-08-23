# snotes UI 视觉规格补充

- 日期：2026-08-23
- 状态：待评审
- 关联文档：[2026-08-22-snotes-design.md](2026-08-22-snotes-design.md)（功能与架构规格，下称「主规格」）
- 参考来源：`docs/notes-wps-reference/`（从 note.wps.cn 实测抓取的 HTML / CSS / JS 前端产物）

> 本文档是对主规格的 **UI 视觉层补充**，不替换主规格。主规格定义「做什么」，本文档定义「长什么样、参数是多少」。功能、数据模型、同步机制、鉴权等均以主规格为准；凡涉及尺寸、颜色、间距、动效、响应式断点、交互态的，以本文档为准。复刻忠实度取「视觉风格复刻」：看得见的视觉参数按原站数值，DOM 结构用 Vue 3 现代写法，编辑器区域因改用 Markdown 不复刻 Quill 工具栏。

---

## 1. 设计原则

1. **所有取色经过设计 token**：组件不直接写十六进制色值，一律引用 §3 的 CSS 变量。新加的颜色必须先进 token 表。
2. **rem 改 px**：原站用 `html{font-size:100px}` 的 rem 体系做多端缩放，我们 PWA 用响应式断点更直接，一律换算为 px（1rem=100px）。
3. **图标用内联 SVG**：不复刻原站 base64 图标 class 体系，用内联 SVG + `currentColor` 或指定色，无外部图标资源依赖。
4. **克制**：每加一个视觉元素要能回答「不做会怎样」。皮肤色只 6 种，动效只保留原站已有的几种。

---

## 2. 整体布局与栅格

基于原站 `#side_bar`、`.clz_editor_container`、`.clz-editor-top-bar` 的实测值。

### 2.1 桌面三栏（视口 > 1020px）

| 区域 | 原站 class | 宽度 | 背景 | 定位 |
| --- | --- | --- | --- | --- |
| 左栏 分组侧栏 | `#side_bar` | 180px | #fafafa | 固定左侧，常驻 |
| 中栏 笔记列表 | `.note_list` | flex 自适应 | #fff | 侧栏右侧 |
| 右栏 编辑器 | `.clz_editor_container` | flex 自适应 | #fff | 最右 |

- 编辑器顶栏内容 `max-width: 810px`、左右 `margin: auto` 居中。
- 分隔线 `.clz_editor_divider`：高 1px、`max-width: 810px` 居中、#e0e0e0、margin-top 55px。
- `#side_bar` 原站 `padding: 8px 8px 0 8px`，桌面端 `top` 偏移 88px（原站预留给顶部 logo 栏），snotes 无顶部 logo 栏，侧栏从 top:0 起算。

### 2.2 响应式断点

沿用原站实测断点，行为具体化：

| 断点 | 侧栏 | 列表 | 编辑器 | 新建按钮位置 |
| --- | --- | --- | --- | --- |
| > 1020px | 常驻 180px | 显示 | 显示，三栏并排 | right 20px |
| 720px–1020px | 隐藏，点 ☰ 滑出覆盖 | 显示 | 显示 | right 20px |
| < 720px | drawer 覆盖 | 与编辑器互斥切换 | 与列表互斥切换，返回键回列表 | right 20px / bottom 32px |

### 2.3 移动端列表↔编辑器切换（核心交互，必须复刻）

视口 < 720px 时，列表与编辑器互斥：
- 点列表项 → 列表隐藏、编辑器显示，编辑器顶栏左侧出现「← 返回」。
- 点「← 返回」→ 编辑器隐藏、列表显示，保持滚动位置。
- 侧栏在移动端是覆盖式 drawer，从左滑入，点遮罩关闭。

### 2.4 顶栏

原站 `.clz-editor-top-bar`：高 56px、`max-width: 810px` 居中、`border-bottom: 1px solid #e0e0e0`、`width: calc(100% - 80px)`。

snotes 复刻顶栏形态，内容替换为：
- 左侧：笔记标题（从正文首行提取，可编辑）。
- 右侧：同步状态指示 + 更多操作菜单（置顶 / 星标 / 颜色 / 移至分组 / 删除）。
- **不复刻 Quill 格式按钮**（改用 Markdown）。

### 2.5 侧栏底部用户区

原站 `.clz_user_container`：`position: fixed`、宽 170px、高 50px、`line-height: 50px`、背景 #fafafa、`margin-left: -8px`。

snotes 内容：同步状态图标 + 令牌设置入口。

---

## 3. 设计 token

实现时所有组件取色的唯一来源。定义在 `src/style.css` 的 `:root`。

### 3.1 文字色

| token | 值 | 用途 | 原站依据 |
| --- | --- | --- | --- |
| `--text-primary` | #464646 | 标题、正文 | 出现 37 次，主文字色 |
| `--text-secondary` | #878787 | 摘要、日期、次要信息 | 18 次 |
| `--text-tertiary` | #bdbdbd | 日期月份数字、占位 | |
| `--text-disabled` | #c4c4c4 | 日期补充文字 | `note_list_item_date_all` |

### 3.2 背景色

| token | 值 | 用途 |
| --- | --- | --- |
| `--bg-app` | #fafafa | 侧栏、app 底色（`#side_bar`） |
| `--bg-surface` | #ffffff | 列表、编辑器、卡片 |
| `--bg-hover` | #f6f6f6 | 列表项、分组项 hover（`.group_item:hover`） |
| `--bg-press` | #efefef | 按下态 |
| `--bg-divider` | #ebebeb | 日期分组头分隔线（`daily-list-header`） |

### 3.3 边框色

| token | 值 | 用途 |
| --- | --- | --- |
| `--border-default` | #e0e0e0 | 编辑器顶栏底边、divider |
| `--border-light` | #ebebeb | 列表项 hover 色条、轻分隔 |
| `--border-input` | #dbdbdb | 按钮、输入框边框（`.header_clean`） |

### 3.4 品牌与状态色

| token | 值 | 用途 | 原站依据 |
| --- | --- | --- | --- |
| `--accent` | #3692f5 | 主蓝：选中、焦点边框、链接 | 出现 18 次 |
| `--accent-press` | #3083dc | 按下态蓝 | 出现 8 次 |
| `--primary-yellow` | #fed634 | 置顶图钉 fill、星标 fill | SVG 解码确认 `fill="#fed634"` |
| `--create-yellow` | #f4dd46 | 新建笔记按钮背景 | `.create-note-button` |
| `--danger` | #ff4949 | 左滑删除按钮 | `.list-item .delete` |

### 3.5 皮肤色板（skin_color，6 色）

原站 CSS 未暴露固定色板数组。从高频出现的暖/冷色中归纳一组克制 6 色：

| 名 | 值 | 备注 |
| --- | --- | --- |
| default | （无） | 不染色 |
| yellow | #fed634 | 与置顶/星标同色系 |
| orange | #ffac00 | |
| red | #e97663 | 偏珊瑚红，非纯红 |
| teal | #5e7a88 | 偏灰青 |
| blue | #3692f5 | 与主色一致 |

**应用方式**：列表项左侧 3px 色条（复用原站 `.list-item{border-left:3px solid #fff}` 机制）。状态优先级：
- 默认：`#fff`。
- hover：`--border-light`。
- 选中：显示该笔记自身的 skin_color（若为 default 则用 `--accent`）。

编辑器顶栏不染色，保持克制。

### 3.6 字体

沿用原站 `html` 字体栈：

```
Helvetica Neue, Helvetica, PingFang SC, Hiragino Sans GB, STHeitiSC-Light,
Microsoft YaHei, 微软雅黑, SimSun, sans-serif
```

桌面正文 16px / 行高 1.7。

---

## 4. 组件视觉规格

### 4.1 分组侧栏（`GroupSidebar.vue`）

- 容器：宽 180px、#fafafa、padding 8px。
- 搜索框：高 36px、背景 #f0f0f0、圆角 4px、左侧放大镜 SVG 图标、占位「搜索笔记」。（原站未抓到独立搜索框样式，按一致风格补。）
- 顶部：「全部笔记」入口常驻。**不做原站的「列表/分组」tab 切换**（原版 `home_tab_icon_list` / `home_tab_icon_group` 是「按笔记看 / 按分组看」的视图切换，snotes 列表本身即支持分组过滤，该切换冗余）。
- 分组项（参考 `.group_item`）：
  - 高 40px、圆角 20px、`margin-left: 8px`、hover #f6f6f6。
  - 左侧 8px 圆点（分组颜色）。
  - 标题：12px、`text-align: left`、单行省略。
  - 右侧 ⋯ 更多按钮：默认隐藏，hover 显示。
  - 内联重命名输入框：高 30px、边框 1px `--accent`、背景 #f8f8f8。
- 底部用户区：fixed bottom、高 50px、宽 170px、#fafafa。

### 4.2 笔记列表（`NoteList.vue`）

参考 `.note_list_item`、`.list-item`、`.daily-list-header`。

- 列表 header：高 56px、`border-bottom: 1px solid var(--border-light)`。
  - 左侧：当前分组名或「全部笔记」，16px 700 `--text-primary`。
  - 右侧：操作（排序、回收站入口）。
- 日期分组头（`.daily-list-header`）：高 76px、`border-bottom: 1px solid var(--border-divider)`、居中。
  - 月份数字：20px `--text-tertiary`。
  - 日期补字：12px `--text-disabled`、`padding-top: 8px`。
- 列表项（`.note_list_item` / `.list-item`）：
  - padding `12px 16px 0 13px`、高 93px。
  - `border-left: 3px solid #fff`；hover 变 `--border-light`；选中变皮肤色或 `--accent`。
  - `transition: all 0.2s`。
- 列表项内容（从上到下）：
  - 标题（`.note_list_item_title`）：14px 700 `--text-primary`、单行省略。
  - 摘要（`.note_list_item_message`）：13px / 行高 19px `--text-secondary`、单行省略、`margin-top: 2px`。
  - 底部行：日期 12px `--text-disabled` + 右侧标记图标（置顶图钉 `--primary-yellow`、星标 `--primary-yellow`）+ 右侧缩略图（`.note_list_item_thumb` 48×48）。
- 左滑删除：
  - `transform: translateX(-80px)`。
  - 删除按钮：宽 80px、`--danger` 背景、白字居中、行高 93px。
- 空状态：居中 SVG 插画 + 文案。
- 新建按钮（参考 `.create-note-button`）：
  - fixed、right 20px、bottom 32px、圆形 54px、`--create-yellow`。
  - 用 CSS 画「+」号替代原站 base64 PNG 图标。

### 4.3 编辑器（`MilkdownEditor.vue` + 顶栏）

- 顶栏（`.clz-editor-top-bar`）：高 56px、`max-width: 810px` 居中、`border-bottom: 1px solid var(--border-default)`。
  - 左侧：标题（从正文首行提取，可编辑）。
  - 右侧：同步状态 + 更多菜单（置顶 / 星标 / 颜色 / 移至分组 / 删除）。
- 编辑区（`.clz_editor`）：`flex: 1`、`overflow: auto`、`max-width: 810px` 居中、padding 24px。
- Milkdown 渲染：白底、行高 1.7、16px、`--text-primary`。标题 / 列表 / 代码块 / 引用块按 Markdown 语义样式，不复刻 Quill。
- 底栏：移动端显示工具栏切换；桌面端隐藏。

### 4.4 回收站视图（`TrashView.vue`）

参考 `.recycle-list-header`、`.header_clean`。

- 复用列表中栏布局。
- header：标题「回收站」15px 700 `--text-primary`。
- 右侧「清空」按钮：12px、边框 1px `--border-input`、`--text-secondary`、padding `0 10px`、圆角。
- 列表项：与笔记列表同形态，操作变「恢复 / 彻底删除」。

### 4.5 令牌页（`TokenGate.vue`）

- 全屏 `--bg-app`。
- 居中卡片：宽 320px、白底、圆角 8px、padding 32px、阴影 `0 1px 3px #d7dae0`。
- 输入框 + 按钮 `--accent`。

---

## 5. 动效

全部沿用原站实测值，不额外增加。

| 元素 | 属性 | 时长 | 缓动 | 原站依据 |
| --- | --- | --- | --- | --- |
| 侧栏滑出 | `left` | 0.3s | ease | `#side_bar{transition:left .3s ease}` |
| 列表项 hover/选中 | `all` | 0.2s | ease-in-out | `.list-item{transition:all .2s}` |
| 编辑器顶栏滑入 | `top` | 0.6s | — | `.clz-editor-top-bar{transition:top .6s}` |
| 编辑器底栏 | `bottom` | 0.3s | ease-in-out | `.clz-editor-bottom-bar{transition:bottom .3s ease-in-out}` |
| 列表项左滑 | `transform` | 0.2s | （与 hover 一致） | 原站未显式标注 |

`prefers-reduced-motion: reduce` 时，上述过渡降为 0.01s（保留状态切换，去掉视觉运动）。

---

## 6. 交互态与同步状态指示

### 6.1 同步状态（侧栏底部 + 编辑器顶栏）

| 状态 | 表现 |
| --- | --- |
| 空闲 | 灰色云图标（或无图标） |
| 推送中 | 旋转动画（原站 `.cloud_refresh_anm`） |
| 有失败任务 | 红点 + 计数（`ui.failedCount`） |
| 离线 | 灰色断云图标 |

### 6.2 键盘快捷键

| 快捷键 | 动作 |
| --- | --- |
| `Cmd/Ctrl + N` | 新建笔记 |
| `Cmd/Ctrl + F` | 聚焦搜索框 |
| `Esc` | 退出搜索 / 关闭弹层 |

---

## 7. 错误处理边界（UI 层）

- 令牌错误（401）：清令牌、回令牌页。
- 同步失败：进失败列表、UI 红点，不阻塞本地读写。
- 图片上传失败：占位符标红 + 可重试，不阻塞编辑。
- IndexedDB 写失败：toast 提示，不假装成功。

---

## 8. 测试对 UI 的要求

补充进主规格 §16 测试策略。

| 层次 | 覆盖 |
| --- | --- |
| 组件测试 | NoteList 渲染（置顶/星标/颜色/缩略图）、选中态、左滑删除、空状态；GroupSidebar 分组项 hover 与重命名 |
| 视觉快照 | Playwright 截三栏布局三档断点的基线截图，便于人工 review（不强制像素比对） |
| E2E 补充 | 移动端断点（<720px）下的列表↔编辑器切换链路 |

---

## 9. 实施约束

- 上述视觉参数是 Task 16–19 的验收标准，实现时逐一对照。
- 设计 token 集中定义在 `src/style.css`，组件通过 CSS 变量引用，禁止硬编码色值。
- 组件 DOM 用 Vue 3 `<script setup>` + 组合式 API，不复刻原站 Vue 2 + data-v 的 scoped 写法。
- 任何偏离本文档视觉参数的地方，须在实施计划中显式记录原因。
