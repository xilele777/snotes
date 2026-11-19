# 2026-11-16 Modern Web Guidance 二次审查

审查日期：2026-11-16

基线：`main@c995488`，应用版本以根目录 `package.json` 为准（审查时为 `1.1.5`）。

状态：原始审查于 2026-11-16 只读完成；2026-11-17 已实施本地修复，进度见下表和文末验收记录。尚未执行版本发布或生产部署，应用版本仍为 `1.1.5`。下文详细整改项中的“现状”保留审查时证据。

## 审查范围

- 范围：应用外壳、笔记列表与编辑器、弹窗和菜单、移动端抽屉、表单、主题与颜色、内容渲染、PWA/性能相关实现，以及仓库可见的部署配置。
- 扫描：执行 `npx.cmd -y modern-web-guidance@latest legacy-scan src --json`，检查已登记的可确定性旧模式。
- 人工核对：检索并读取以下现代 Web 指南：`dialog`、`accessibility`、`html`、`navigation-drawer`、`forms`、`dark-mode`、`color`、`security`、`responsive-design`、`sanitize-untrusted-html`、`performance`。
- 排除：`node_modules/`、`dist/`、`tmp/` 和历史参考文件 `docs/notes-wps-reference/`；仓库外的 Cloudflare、反向代理和线上响应未直接读取。

## 扫描结果

```json
{
  "targetDir": "src",
  "totalFindings": 0,
  "guides": [],
  "activeRuleCount": 35,
  "activeGuideCount": 33,
  "skippedDocsAndTestsCount": 52,
  "note": "No legacy patterns found across 33 guides (35 rules; ~20% of the guidance corpus). Use 'search <topic>' for feature-specific guidance."
}
```

扫描未发现已注册的旧模式，不等于覆盖全部现代 Web 规则。该扫描只覆盖约 20% 的指南语料，因此下面的结论来自源码人工核对，并按证据强度分类。

## 结论

整体基础较好：未发现明显的生产端 XSS 注入入口，也未发现已确认的高危功能故障。需要跟踪的事项分为三类：

- **5 条已确认代码层差异**：MWG-02、MWG-03、MWG-05、MWG-06、MWG-09。可直接由当前源码行为或标记确认。
- **4 条现代规范改进**：MWG-01、MWG-04、MWG-07、MWG-08。现有实现并非均已功能故障，但偏离现代平台推荐做法，存在可维护性、语义或渐进增强改进空间。
- **1 条线上核验项**：MWG-10。仓库内配置未声明安全响应头，但不能据此断言线上缺失。

优先级定义：

- P1：已确认的高影响问题，尽快处理。
- P2：可能影响无障碍、安全性或后续维护，应在近期迭代处理。
- P3：现代语义和长期一致性改进，可随相关模块重构处理。
- Verify：需要结合线上或真实浏览器确认，不能仅凭仓库代码下结论。

本轮没有 P1。

## 问题清单

| ID | 分类 | 优先级 | 问题 | 证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| MWG-01 | 现代规范改进 | P2 | 自定义弹窗重复实现浏览器原生焦点与模态能力 | `src/components/useDialogFocus.ts`（原审查证据，已移除） | 本地已迁移 |
| MWG-02 | 已确认代码层差异 | P2 | 输入控件边框对比度不足 | `src/styles.css:14-16,55-57` | 本地已修复 |
| MWG-03 | 已确认代码层差异 | P2 | 图片灯箱主图替代文本为空 | `src/components/ImageLightbox.vue:9,181-184` | 本地已修复 |
| MWG-04 | 现代规范改进 | P2 | 移动抽屉具有模态行为，但缺少对应现代模态语义 | `src/App.vue:43-55,91-103,164-169` | 本地已整改 |
| MWG-05 | 已确认代码层差异 | P3 | 菜单统一拦截 Tab，打断自然焦点流 | `src/components/ActionMenu.vue:60-66` | 本地已修复 |
| MWG-06 | 已确认代码层差异 | P3 | 应用外壳缺少每个视图稳定、唯一的主内容地标 | `src/App.vue:169-193`；`src/components/NoteDetail.vue:410`；`src/components/StatsView.vue:144` | 本地已修复 |
| MWG-07 | 现代规范改进 | P3 | 缺少提前声明主题能力的 `color-scheme` 元数据 | `index.html`；`src/styles.css:2,37` | 本地已增强 |
| MWG-08 | 现代规范改进 | P3 | 搜索区域仍用 `div role="search"` | `src/components/NoteSearch.vue:24-27` | 本地已增强 |
| MWG-09 | 已确认代码层差异 | P3 | 空输入时禁用提交，原生校验提示无法触发 | `src/components/TokenGate.vue:10-25` | 本地已修复 |
| MWG-10 | 线上核验项 | Verify | 仓库内部署配置未声明常用安全响应头 | `public/_headers`；`deploy/Caddyfile.example`；`worker/security-headers.ts` | 修复前线上已核验，基础策略已实现；待发布后复核 |

## 详细整改项

### MWG-01：将自定义弹窗体系迁移到原生 `<dialog>`

**分类：现代规范改进，不是已确认的运行故障。**

**现状**

`useDialogFocus.ts` 已实现焦点陷阱、Esc 关闭、多层弹窗最上层判断、`aria-modal`、`inert`、焦点恢复和背景点击过滤。`ConfirmDialog`、`DeleteNotebookDialog`、`GroupDialog`、`HistoryDialog`、`ImageLightbox`、`KnowledgeBaseForm`、`KnowledgeBaseWorkspace` 的内部弹窗、`NoteInfoDialog`、`TableDialog`、`WordCountDialog` 均依赖它。

这套实现说明当前并不是“没有焦点管理”，而是由应用重复维护浏览器原生模态能力。交互组合越多，焦点、动画、滚动和遮罩处理越容易出现回归。

**整改建议**

1. 新建统一的原生 `<dialog>` 封装，通过 `showModal()` 打开，并通过 `close()` 或 `<form method="dialog">` 关闭。
2. 不要再给原生模态对话框添加 `role="dialog"`、`aria-modal`、手写焦点陷阱、`inert` 切换、Esc 关闭处理器或关闭后的手动焦点恢复。浏览器负责对话框语义、背景 inert、焦点包含、顶层渲染、Esc、返回手势和焦点恢复。
3. `closedby` 作为渐进增强使用。支持的浏览器可用 `closedby="any"` 实现点击遮罩关闭；不支持时只失去点击遮罩关闭，Esc 和返回手势仍可关闭模态框。
4. 使用下面的两条滚动约束，避免背景页面跟随滚动手势，同时不要用 `overflow: hidden` 或 `position: fixed` 锁住 `html`/`body`：

   ```css
   dialog:modal {
     overscroll-behavior: contain;
   }

   dialog::backdrop {
     overflow: hidden;
     overscroll-behavior: contain;
   }
   ```

5. 先迁移 `ConfirmDialog` 和 `ImageLightbox`，再迁移表单类和多层弹窗；`KnowledgeBaseWorkspace` 中直接写出的内部弹窗需要一并收敛。
6. 仅在原生方法不可用或业务确实需要时保留补丁，不继续扩展手写焦点体系。

**验收**

- 打开、关闭、Esc、遮罩点击、关闭按钮和确认/取消按钮行为一致。
- 多层弹窗只有最上层响应关闭请求，关闭后焦点回到打开前的控件。
- 焦点不会逃到背景内容，背景不能被键盘或指针误操作。
- 滚动对话框或遮罩时不会带动背景页面，且页面布局不因滚动锁发生位移。
- 深色主题、过渡动画和现有 E2E 不回归。

### MWG-02：提高表单控件边框对比度

**分类：已确认代码层差异。**

**现状**

`src/styles.css` 中的输入边框颜色为：

| 主题 | Token | 值 | 相对背景 | 对比度 |
| --- | --- | --- | --- | ---: |
| 浅色 | `--border-input` | `#bdc3cf` | `#ffffff` | **1.77:1** |
| 深色 | `--border-input` | `#606370` | `#27282f` | **2.46:1** |

当边框用于识别输入框、选择框等非文本控件的边界时，WCAG 非文本对比度目标是 **3:1**。当前值未达到该目标。

**整改建议**

- 仅为可交互控件边界调整 `--border-input`，不要盲目提高所有装饰性边框。
- 选择经浏览器取色和自动对比度测试验证的新值，并同时检查默认、hover、focus、disabled 状态。
- 如果某个边框不是识别控件的必要信息，应在设计规范中明确其装饰角色，避免用低对比度边框表达唯一边界。

**验收**

- 浅色、深色主题下，输入框、选择框、开关轨道等可操作控件边界均不小于 3:1。
- 不影响现有 focus ring、禁用态和危险操作的语义色。
- 对比度计算结果纳入测试或设计验收记录，至少覆盖黑白两种主题。

### MWG-03：为图片灯箱提供有意义的替代文本

**分类：已确认代码层差异。**

**现状**

`ImageLightbox.vue` 将图片数据声明为 `images: string[]`，主图渲染为 `alt=""`。灯箱中的图片是主要内容，不是装饰背景；空替代文本会让辅助技术跳过图片信息。

**整改建议**

- 将图片数据扩展为 `{ src, alt }`，从 Markdown 图片语法保留作者写的替代文本。
- 在无法获得替代文本时使用“图片 N / 总数”之类的可访问名称作为兜底，不要伪造图片内容描述。
- 检查列表缩略图、品牌图和装饰图标：装饰图可继续使用空 `alt`，但灯箱主图不能沿用该处理。

**验收**

- 屏幕阅读器可区分灯箱中的当前图片和图片总数。
- 作者提供 alt 时能读出原文本；没有 alt 时仍有可理解的兜底名称。
- `ImageLightbox` 组件测试覆盖单图、多图、切换和 alt 回退。

### MWG-04：补齐移动导航抽屉的模态语义

**分类：现代规范改进，不是“抽屉完全无效”。**

**现状**

`App.vue` 在紧凑视口下使用遮罩、`inert`、Esc 和手写 Tab 循环，行为上已把侧栏当作模态抽屉，但没有提供对应的对话框语义或现代顶层机制。桌面侧栏仍应保持普通导航区域，不应改成模态。

**整改建议**

- 仅在紧凑模式、抽屉打开时提供模态语义和焦点边界；桌面端保持普通 `<aside>`/`<nav>`。
- 若移动抽屉只作为抽屉使用，优先使用原生 `<dialog>` 和 `showModal()`。
- 若同一元素在宽屏必须成为普通侧栏，按导航抽屉指南使用普通元素加 `popover="manual"`，仅在移动抽屉状态添加 `role="dialog"`，桌面侧栏状态移除该角色，并由应用集中管理模态行为。
- 确认遮罩关闭、Esc 和抽屉内关闭按钮保持一致，且背景内容无法被辅助技术或键盘操作。

**验收**

- 键盘打开抽屉后，焦点进入抽屉且只在抽屉内移动。
- Esc、遮罩点击和关闭按钮都能关闭，关闭后焦点回到触发控件。
- 背景内容在抽屉打开时不可交互，关闭后恢复。
- 桌面侧栏和 1021px 以上布局不发生变化。

### MWG-05：修正菜单的 Tab 焦点行为

**分类：已确认代码层差异。**

**现状**

`ActionMenu.vue` 对 Escape 和 Tab 都执行 `preventDefault()`，随后关闭菜单并归还焦点。Tab 因此表现得像 Escape，阻止用户自然移动到下一个控件，这是已确认的代码行为。

**整改建议**

- 使用原生 `popover` 处理轻触关闭和顶层渲染，减少手写定位/外部点击逻辑。
- 保留方向键在菜单项间移动的语义；将 Esc 与 Tab 分开处理。
- Esc 关闭并把焦点还回触发器；Tab 关闭后允许焦点按正常页面顺序继续移动。
- 对 `role="menu"` 和 `role="group"` 两种调用方式分别编写键盘测试。

**验收**

- 方向键、Home、End、Enter 和 Esc 行为稳定。
- Tab 不再被无条件取消，关闭后焦点不会意外跳回触发器。
- 菜单贴近视口边缘、出现虚拟键盘或滚动时仍完整可见。

### MWG-06：建立稳定的主内容地标

**分类：已确认代码层差异。**

**现状**

当前 `<main>` 仅出现在 `NoteDetail.vue` 和 `StatsView.vue` 内部，而 `App.vue` 的应用外壳使用多个 `section`。在列表、设置、笔记本列表等状态下，文档没有稳定的主内容 `main` 地标。

**整改建议**

- 在应用外壳建立一个稳定的主内容地标，根据当前视图容纳列表、编辑器、统计或设置内容。
- 调整已有的内部 `<main>`，避免页面切换时出现多个或嵌套的 `main`；应用外壳承担地标时，内部容器应改为普通结构元素。
- 继续保留侧栏导航、搜索、工具区和状态提示的可访问标签。

**验收**

- 每个主要视图都有且只有一个可识别的主内容地标。
- 地标导航不会把装饰性侧栏或背景层当作主内容。
- 移动端列表/编辑器切换时地标仍稳定、可定位。

### MWG-07：补充 `color-scheme` 元数据

**分类：现代规范改进，不是已确认的白闪故障。**

**现状**

`index.html` 有首帧主题初始化脚本和动态 `theme-color`，但头部没有：

```html
<meta name="color-scheme" content="light dark" />
```

`src/styles.css` 已在根元素上应用 `color-scheme`，但元数据可以在样式和脚本执行前后更早向浏览器声明页面支持两套主题。它用于减少首帧前原生 UI 或画布使用错误主题的机会，不保证在所有浏览器和加载条件下完全消除闪烁。

**整改建议**

- 在 `<head>` 加入 `color-scheme` 元数据，并与首帧主题脚本保持一致。
- 检查浏览器原生控件、滚动条和表单焦点环在浅色/深色首帧中的表现。

**验收**

- 浅色和深色首次加载时，原生控件和画布尽早采用匹配主题。
- 原生控件和滚动条采用匹配主题。
- `theme-color` 与 `color-scheme` 不互相矛盾。

### MWG-08：使用原生 `<search>` 语义

**分类：现代规范改进。**

**现状**

`NoteSearch.vue` 使用：

```html
<div class="note-search-block" role="search">
```

现代 HTML 已有 `<search>` 元素，可直接表达搜索区域，无需再写 `role="search"`。

**整改建议**

- 在不改变现有布局和测试选择器的前提下，将容器替换为 `<search>`。
- 保持输入框的标签、清除按钮和键盘行为不变。

**验收**

- 搜索地标在辅助技术中可被识别。
- 现有搜索、清除、快捷键和 E2E 不回归。

### MWG-09：允许提交，以原生校验提示空输入

**分类：已确认代码层差异。**

**现状**

`TokenGate.vue` 的输入具有 `required`，但提交按钮在 `!input.trim()` 时被禁用，提交函数也会静默返回。空输入时按钮不可用，原生约束验证提示无法出现。

**整改建议**

- 保留 `required`，允许用户提交并由原生约束验证提示空输入。
- 如果产品坚持禁用按钮，应在按钮附近提供可被辅助技术读取的原因，而不是仅靠禁用态。
- 对令牌错误、网络错误和空输入分别提供明确状态。

**验收**

- 空输入提交时出现可见且可聚焦的校验提示。
- 输入有效令牌后仍能正常进入。
- 键盘用户和屏幕阅读器都能理解当前错误与修复方式。

### MWG-10：在部署边界确认安全响应头

**分类：线上核验项。**

**现状**

仓库可见配置中：

- `public/_headers` 只声明缓存策略；
- `deploy/Caddyfile.example` 只配置压缩和反向代理；
- `wrangler.jsonc` 没有声明安全响应头。

这只能证明 **仓库内配置未声明**，不能证明线上一定缺失；Cloudflare、反向代理或托管平台可能在仓库外补充。

**整改建议**

- 先对正式域名执行只读响应头检查，记录 `Content-Security-Policy`、`Strict-Transport-Security`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、`frame-ancestors`/`X-Frame-Options` 和框架保护状态。
- 如果缺失，在 Cloudflare/反向代理统一补充，并同时更新 `public/_headers` 或部署文档中的可复制配置。
- CSP 需要兼容 `index.html` 的首帧内联主题脚本；使用 hash/nonce 或抽出脚本，不能直接以不匹配的 `script-src 'self'` 上线。
- 对不需要被嵌入的页面使用 `frame-ancestors 'none'` 与 `X-Frame-Options: DENY`；若允许同源嵌入，再按指南调整为 `frame-ancestors 'self'` 与 `SAMEORIGIN`。

**验收**

- 正式域名、静态资源和 API 的关键响应头符合部署策略。
- CSP 不会阻断主题初始化、字体、图标、编辑器资源和图片加载。
- 新增配置可重复部署，并有线上响应头快照作为发布记录。

## 已核实的正向实践

以下结论来自静态源码核验，不代表已完成真实设备或辅助技术测试：

- Markdown 原始 HTML 经过 `escapeRawHtml` 降级，Vditor 预览配置 `sanitize: true`，媒体嵌入关闭。
- 生产代码未发现 `v-html`；`markdown-clipboard.ts` 的 `innerHTML` 仅写入惰性 `<template>`，用于裁剪剪贴板 HTML，未直接挂载到页面。
- 已处理 `prefers-reduced-motion`、`100dvh`、安全区域、容器查询和粗指针触控尺寸。
- 首帧前初始化主题，并动态更新 `theme-color`。
- 侧栏导航使用语义化 `<nav>`，主要按钮具备名称、状态和 ARIA 关系。
- Service Worker 对 API 使用 `NetworkOnly`，避免把用户数据简单纳入通用运行时缓存。

## 建议实施顺序

1. 完成 MWG-10 的线上响应头核验；若缺失，先补部署边界。
2. 修复 MWG-02、MWG-03、MWG-05、MWG-06、MWG-09 这些已确认代码层差异。
3. 抽取原生 `<dialog>` 封装，先迁移 MWG-01 中的确认框和灯箱，再按 MWG-04 处理移动抽屉。
4. 补充 MWG-07 和 MWG-08 的语义与元数据增强。
5. 全部完成后执行 `npm run test:all` 与 `npm run build`；如涉及发布，再严格遵循根目录发布规范和 `AGENTS.md`。

## 原始审查验证与限制（2026-11-16）

- 审查阶段只做静态代码核验和配置读取，未修改业务代码，未执行 `npm run test:all`、生产构建或部署；文档落地时仅新增本记录并更新 `docs/README.md` 索引。
- `legacy-scan` 仅覆盖约 20% 的指南语料；0 条发现不代表所有现代 Web 规则均已满足。
- 对比度数字来自颜色值计算；最终仍需在真实浏览器、缩放下和实际字体渲染下复核。
- 线上安全头、真实屏幕阅读器、跨浏览器和真机键盘行为尚未在本轮启动，相关项目保留为待验收。

## 本地修复与验收（2026-11-17）

### 实现记录

- **MWG-01**：新增 `NativeDialog.vue`，所有原自定义模态框通过 `showModal()` 打开，删除 `useDialogFocus.ts`。焦点包含、背景不可交互及焦点归还交给浏览器。使用安全的 `autofocus`、`closedby` 和两条滚动约束；不支持 `closedby` 时以按下和释放均在边界外的指针判断保留遮罩关闭，拖选到遮罩不会丢表单。
- **弹窗过渡兼容**：以 `data-closing` 和 `getAnimations()` 等待退出，再原生关闭，兼容缺少离散 `display` / `overlay` 过渡的浏览器；尊重减少动画偏好。仅为保持退出动画拦截原生 `cancel`，不重建 Escape 键或焦点循环。表格提交需要立即恢复正文光标，先同步释放原生模态再插入，取消操作仍保留退出动画。
- **MWG-02**：浅色、深色 `--border-input` 分别调整为 `#858b98`、`#858996`，修复搜索框覆盖样式，调整深色开关选中态的滑块色。基于实际 CSS token 的自动计算覆盖默认、悬停、焦点及各相邻背景的 3:1 目标；disabled 仍为不可操作状态。
- **MWG-03**：图片元数据从编辑器到详情再到灯箱保留 `{ src, alt }`，缺失说明时使用“图片 N / 总数”。按钮在首末张被禁用后，方向键仍能切换；快捷键避让其他已获得焦点的浮层。
- **MWG-04**：同一个侧栏仅在紧凑布局使用 `popover="manual"`，打开时提供有名称的 dialog / aria-modal，集中对主内容设 `inert`。桌面移除抽屉角色和 popover，保留导航与尺寸偏好。
- **MWG-05**：菜单支持原生 auto popover，缺失时保留 fixed / 外部点击降级；Tab / Shift+Tab 不再取消默认移动，只以触发器作为浏览器顺序导航的起点。Escape、方向键及菜单与按钮组的既有语义保留。
- **MWG-06～09**：外壳提供唯一、稳定的 `main`，内部重复主地标改为普通容器，登录页也提供主地标；使用 subgrid 保留分栏布局。新增主题元数据、原生 `search`，令牌提交保持可操作，以 `required` 和非空白 `pattern` 触发浏览器校验。
- **MWG-10**：按用户提供的正式域名完成公开只读 GET 核验，[修复前快照](2026-11-17-security-headers-before.md)中的 HTML、SVG 和 health API 均未返回所查六个安全头。静态 `_headers`、Worker / Node.js 中间件及 Caddy 示例已加入基础策略，详见[安全响应头与上线复核](../security-headers.md)。

### 验证结果

- `npm run test:all`：**64 个前端测试文件 / 855 项、16 个 Worker 测试文件 / 208 项、8 个服务器测试文件 / 75 项全部通过**，共 1,138 项。
- `npm run build`：类型检查、生产构建及 PWA 资源生成通过。
- 浏览器回归选取 `agents`、`full-flow`、`knowledge-bases`、`modern-web-guidance`、`product-design`、`ui-consistency`、`workspace` 七个套件，共 69 项；发现的表格焦点与灯箱方向键两处回归已修复。随后对这两项、触摸灯箱、全部现代 Web 验收和表单拖选进行 **11 项定向复测，全部通过**，包含新增图片说明与兼容路径两项。
- 真实浏览器覆盖桌面、720 / 390 / 320px、深浅主题、唯一主地标、原生背景焦点阻断和焦点返回、嵌套抽屉弹窗、双向 Tab、遮罩拖选保护、图片缩放/切换/下载、原生校验和编辑保存。浏览器原生弹窗允许 Tab 到浏览器界面，因此测试验证背景控件不可聚焦，不再要求手写循环回到首项。
- 兼容路径测试移除 `closedBy` 接口并禁用离散过渡，验证指针降级与退出时保留原生模态；该模拟不能替代 Safari / Firefox 实机验证。
- 已人工检查桌面浅色工作区、手机深色编辑器、深色笔记本首页及原生确认弹窗截图，未发现分栏错位、弹窗透明残留或窄屏溢出。
- 对本地 Wrangler 的 `/`、`/snotes.svg`、`/api/health` 执行 GET，确认静态与 API 均返回基础策略；本地 HTTP API 不返回 HSTS，HTTPS 分支由后端测试覆盖。静态规则在本地 HTTP 也会附带 HSTS，浏览器只在 HTTPS 下接受它。

### 保留边界

- **未提交、打标签或部署，版本仍为 `1.1.5`。** 本次改动记录在 `CHANGELOG.md` 的 `[Unreleased]` 下；正式发布时再执行根目录规定的完整发布流程。
- **MWG-10 仍待正式发布后复核**：本地实现不能证明正式域名已返回新头。基础 CSP 仅包含 `object-src`、`base-uri`、`frame-ancestors`，不含严格 `script-src` / Trusted Types；后续需为首屏内联脚本和 Vditor 先验证 hash/nonce 与 Report-Only 策略。
- HSTS 首次仅 `max-age=300`，不含 `includeSubDomains` 或 `preload`；确认 HTTPS 稳定后再逐步延长。
- 本轮浏览器自动化使用 Playwright Chromium；真实屏幕阅读器、Safari / Firefox 以及真机验证尚未执行，不声明完成这些验收。
