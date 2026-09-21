# 表格编辑体验与高亮标记设计

日期：2026-09-21。目标版本：v0.16.0。

## 1. 问题

- 表格插入后无法增删行列、无法调整对齐，只能删掉重插。
- 表格在文末或紧挨图片时，点击后没有光标，无法在表格后继续输入。
- 表格单元格内边距固定，用户希望能调整行列间距。
- 缺少高亮标记，强调只能靠加粗。

## 2. 方案

### 2.1 表格操作 UI：接入 Milkdown table-block

- 在 `MilkdownEditor.vue` 里 `.use(tableBlock)`，并通过 `tableBlockConfig` 把按钮图标换成项目 `icons.ts` 里的描边图标（`plus`、`trash`、对齐图标新增 `alignLeft`、`alignCenter`、`alignRight`，拖拽把手用 `more` 的竖排变体 `grip`）。
- table-block 自带：行列增删按钮、行列拖拽换位、列对齐。只读态（回收站）下 ProseMirror 不可编辑，组件的按钮通过 CSS 在 `[contenteditable='false']` 下隐藏。
- 样式写在 `styles.css`，只覆盖组件用到的类名：`.milkdown-table-block`、`.table-wrapper`、`.handle`、`.button-group`、`.add-button`、`.drag-preview`。
- Markdown 输出不变，仍是 GFM 表格。

### 2.2 光标缺失：启用 cursor 与 trailing 插件

- 根因假设：表格是块级节点，位于文档末尾时 ProseMirror 找不到可放文本光标的位置，点击落在表格外时光标不出现；紧挨图片时同理。
- 修法：`.use(cursor)` 提供 gap cursor（可用方向键把光标放到表格前后），`.use(trailing)` 保证文档末尾始终有一个空段落。
- 验收：E2E 里在只含一张表格的笔记中按 ↓ 或点击表格下方，能继续输入文字。

### 2.3 表格密度：全局设置

- `Settings` 新增 `tableDensity: 'compact' | 'medium' | 'loose'`，默认 `medium`，与主题等一样存 localStorage、不进同步。
- `applySettings` 落到 `<html data-table-density>`，CSS 用 `--table-cell-padding` 驱动 `th, td` 的内边距：紧凑 4px 8px，标准 8px 12px，宽松 12px 16px。
- 外观设置面板新增「表格密度」分段选择。
- 不做逐表调整：Markdown 表格没有间距语义，逐表调整只能内联 HTML，会污染正文。

### 2.4 高亮标记 `==文字==`

- 新增 `src/editor/highlight.ts`，包含：
  - mark schema `highlight`，`toDOM` 输出 `<mark>`，`parseDOM` 识别 `mark` 标签。
  - remark 插件：解析阶段用 `mdast-util-find-and-replace` 把文本节点中的 `==(.+?)==` 替换为 `highlight` 节点；序列化阶段注册 `toMarkdownExtensions` 的 `highlight` handler，输出 `==文字==`。
  - 输入规则：输入 `==文字==` 后自动转成高亮。
  - 命令 `toggleHighlightCommand` 与快捷键 `Mod-Shift-H`。
- `format.ts` 的 `FormatAction` 新增 `highlight`，`readFormatState` 上报 `highlight` 状态，工具栏在「行内代码」后加「高亮」按钮（图标 `highlight`）。
- 已知限制：高亮内部不再解析其他标记（`==**粗**==` 里的 `**` 按字面显示），`**==a==**` 可以。
- 样式：`mark` 用浅色底、继承文字色，深色主题用暗黄底。

## 3. 测试

- `format.test.ts`：`highlight` 的 toggle 与状态读取。
- `highlight.test.ts`：remark 解析与序列化往返（`==a==` 到 mdast 到 `==a==`），不匹配的 `=` 不误伤。
- `settings.test.ts`：`tableDensity` 解析与落地。
- `FormatToolbar.test.ts`、`NoteDetail.test.ts`：新按钮存在并触发。
- E2E：表格后能继续输入；`==a==` 渲染成 `mark`。

## 4. 不做

- 逐表间距、字号、字体颜色：都需要内联 HTML，与 Markdown 存储冲突。
- 表格单元格合并：GFM 不支持。
