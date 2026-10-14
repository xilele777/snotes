# 语雀知识库技术逆向报告

- 调研日期：2026-10-14。
- 状态：调研完成；本报告记录调研阶段事实。后续授权开发的 snotes 功能见[知识库使用与实现说明](knowledge-bases.md)。
- 方法：登录后的页面检查、实际请求与响应结构检查、已加载前端 JavaScript bundle 的静态分析。
- 配套方案：[snotes 知识库设计草案](superpowers/specs/2026-10-14-knowledge-base-design.md)。

## 1. 结论与证据范围

语雀知识库的核心是 **Book（知识库）+ Doc（文档）+ CatalogNode（目录节点）**，而不是只给文档增加文件夹字段。知识库列表上还有 BookStack，用于组织多个知识库。目录结构、文档正文、知识库首页和权限分别管理。

本报告使用三种证据等级：

| 标记 | 含义 |
| --- | --- |
| A：运行核验 | 页面实际显示，或本次浏览产生的请求及响应中确认 |
| B：代码核验 | 已加载的前端 bundle 中找到定义或调用；未执行对应写操作 |
| C：推断 | 根据前端与接口结构推断，不能当作服务端实现事实 |

取得的是浏览器收到的编译后前端代码。没有取得语雀服务端源码、数据库 schema 或原始 TypeScript 仓库；不能据此断言服务端使用何种数据库、事务算法或协同编辑算法。bundle 中有离线代码也不等于当前浏览器、账号及所有客户端均启用了这些能力。

只访问知识库、设置、目录管理、目录历史、文档管理和已有文档；没有创建、修改、移动、删除或恢复业务内容，没有调用写接口验证。本报告不保留 Cookie、登录请求、令牌及账号凭据，也不复制用户正文。

## 2. 实际页面与功能分工

| 页面 | 功能 | 证据 |
| --- | --- | --- |
| `/dashboard/books` | 常用知识库、个人知识库、邀请协作的知识库；库的集合展示 | A |
| `/:owner/:book` | 知识库首页、文档数与字数、介绍内容、目录及搜索入口 | A |
| `/:owner/:book/settings/basic` | 名称、图标、简介、访问路径、封面 | A |
| `/r/:owner/:book/toc` | 目录搜索、目录节点管理、展开层级、尾部文档信息、历史入口 | A |
| `/r/:owner/:book/docs` | 文档列表、作者和状态筛选、更新时间排序、多选入口 | A |
| `/r/:owner/:book/trash` | 知识库回收站入口 | A：入口；恢复细节未操作 |
| `/:owner/:book/:doc` | 文档阅读，左侧知识库目录，右侧当前文档大纲 | A |

**知识库目录与文档大纲是两个不同结构**：前者组织多篇文档，后者来自当前正文里的标题。

目录管理与文档管理分开，说明“属于某知识库”和“被放进它的目录”不能直接混为一谈。首页代码还会对文档列表进行是否已在目录中的判断。共享、删除、导入导出、移动复制等命令在前端另有操作模块，不能都塞进目录树渲染组件。

## 3. 前端模块与状态管理

实际加载的 runtime URL 包含 React / React DOM `16.13.1`。产物使用 chunk 拆分；不能把这个依赖版本当作语雀产品版本。

| 产物 | 检查到的职责 | 证据 |
| --- | --- | --- |
| `pc.3aa5c457.js` | 应用启动、注册 `book`、`doc` 等状态模块，目录节点标准化 | B |
| `common.2ef32621.js` | API 包装、知识库和文档状态模块、通用服务导出 | B |
| `c__DashboardBooks.d99bdd6a.async.js` | 知识库列表、BookStack、常用知识库、集合内移动排序 | A/B |
| `c__BookOverview.813cefff.async.js` | 首页介绍、目录、布局与显示选项、首页内容保存流程 | A/B |
| `c__CatalogModule.dfbe62e1.async.js` | 目录项渲染、选中、缩进、展开状态、拖动相关 props | B |
| `c__BookManage.19d836eb.async.js` | 设置、目录管理、目录历史、批量移动复制删除 | A/B |
| `c__service-data-layer.5fb87b4b.async.js` | 在线/离线服务钩子、本地目录操作、离线目录同步 | B |
| `c__DocActionMenu.ef750a1f.async.js` | 文档命令、导入导出、模板等操作分派 | B |

### 3.1 `book` 状态模块

`common` 的 webpack 模块 `445616` 定义 `namespace: "book"`，采用 `state / effects / reducers` 形式。代码中可见：

- `docs`、`docsLoaded`、`toc`、`catalog`、`trash`。
- `collaborators`、`permission`、`contributors`。
- 从 `window.appData` 取初始化数据，补充知识库 `namespace`。
- `refreshDocsAndToc` 调用 `books.toc({ id, include_docs: true, include_contributors: false })`，再分别派发 `updateDocs` 和 `updateToc`。
- `updateSettingProps` 只取 `name / slug / description / cover / book_icon`。
- `updatePartial` 检查对象 id，避免把另一知识库的结果更新到当前库。

这是 Dva 风格的状态组织；这里确认的是代码形态，没有进一步核验完整依赖链。可借鉴的是按领域拆模块、区分异步副作用与状态归约，snotes 可继续用 Pinia 实现。

### 3.2 `doc` 状态模块

`common` 模块 `257823` 定义 `namespace: "doc"`。`getDetail` 根据 `book_id / slug / book_slug / user_login` 加载文档，维护 `loaded / error`，处理预取数据和权限等响应元信息。目录树不会把所有正文当作节点内容装进去。

## 4. 数据结构逆向

### 4.1 知识库与知识库集合

Book 设置和状态代码中确认了 `id / name / slug / description / namespace / cover / book_icon / abilities` 等字段。Doc 响应使用 `book_id` 关联所属知识库。

BookStack 在知识库列表之上组织多个 Book。列表代码中移动库的参数包含：

```text
targetStackId、sourceStackId、sourceBookIds、targetBookIds
```

因此 BookStack 相当于“知识库集合”，不是库内的章节目录。这两层应在产品设计和数据模型上分开。

### 4.2 目录节点

实际 `GET /api/books/:id/toc` 响应包含独立的 `toc` 与 `docs`。以下为匿名化的节点形状，示例值不是账号真实数据：

```json
{
  "type": "DOC",
  "title": "示例文档",
  "uuid": "book-id:node-id",
  "url": "document-slug",
  "parent_uuid": null,
  "child_uuid": null,
  "prev_uuid": null,
  "sibling_uuid": null,
  "doc_id": 123,
  "id": 123,
  "level": 0,
  "open_window": 1,
  "visible": 1
}
```

| 字段 | 确认或解释 |
| --- | --- |
| `uuid` | 目录节点身份，与文档 id 分开；实际响应存在知识库前缀 |
| `doc_id` | 文档引用；其他类型节点不一定有文档 |
| `parent_uuid` | 父节点引用 |
| `child_uuid` | 首个子节点引用，插入代码会更新它 |
| `sibling_uuid` | 后续同级节点引用，插入删除代码会维护它 |
| `prev_uuid` | 前序连接；代码中首个子节点可指向父节点，不能简单理解为永远指向前一兄弟 |
| `level` | 层级冗余信息，移动子树代码会重算后代层级 |
| `url` | 文档 slug 或链接地址，取决于节点类型 |
| `visible / open_window` | 显示和打开方式字段；不应当作访问权限判断 |

代码定义四种节点类型：`TITLE / DOC / LINK / UNCREATED_DOC`。实际账号目录只有一个 `DOC`，其余类型是 B 级代码核验，没有创建测试。

目录采用扁平节点数组，配合父子和前后连接维护树。**这能证明传输及客户端模型，不能证明数据库按这些列存储。**

### 4.3 文档与首页内容

文档列表响应确认 `book_id / slug / type / format / status / draft_version / published_at / word_count` 等字段。本次样本文档 `type=Doc`、`format=lake`；详情有 `body_asl / content` 及权限元信息，存在草稿与发布相关字段。

知识库 overview 返回：

```text
wordCount、contributors、enableCustomBody、enableCatalog、order、layout、customIndex
```

`customIndex` 为 Doclet 形态，包含 `category=book_index_page`、`target_type=Book`、`target_id` 及正文/草稿字段。首页代码通过 `doclets.updateContent → publish → findOne` 保存及重读首页内容。这表明首页介绍不是目录节点，也不只是库的简介字符串。

## 5. 接口清单与核验等级

下表全部使用参数占位符。内部网页接口不等于语雀开放 API，不应作为 snotes 对外兼容契约。

| 方法与路径 | 职责 | 证据 |
| --- | --- | --- |
| `GET /api/mine/book_stacks` | 知识库集合 | A：请求；响应本次未取得 |
| `GET /api/mine/user_books` | 按用户类型读取知识库 | A：请求 |
| `GET /api/books/:id/overview` | 首页内容、统计、显示设置 | A：响应 |
| `GET /api/docs?book_id=:id` | 库内文档元数据 | A：响应 |
| `GET /api/books/:id/toc?include_docs=true&include_contributors=false` | 目录及文档元数据 | A：响应 |
| `GET /api/docs/:slug?book_id=:id&…` | 按库与 slug 取正文详情 | A：响应结构 |
| `GET /api/versions?item_type=BookToc&item_id=:id&offset=0&limit=200&exclude_object=true` | 目录历史列表 | A：请求；页面显示暂无历史 |
| `GET /api/versions/:id` | 历史详情 | B |
| `GET /api/catalog_nodes` | 目录节点读取 | B |
| `PUT /api/catalog_nodes` | 根据 action 更新目录 | B |
| `PUT /api/catalog_nodes/batch` | 批量操作 | B |
| `PUT /api/catalog_nodes/move` | 移动 | B |
| `PUT /api/catalog_nodes/copy` | 复制 | B |
| `PUT /api/catalog_nodes/settings` | 目录显示配置 | B |
| `PUT /api/catalog_nodes/offline_sync` | 离线目录同步 | B |
| `PUT /api/catalog_nodes/revert` | 恢复目录历史 | B |
| `PUT /api/catalog_nodes/publish_doc` | 目录相关文档发布 | B |
| `PUT /api/catalog_nodes/ensure_update_toc_yml` | 目录表示更新入口；准确内部用途未确认 | B |
| `POST /api/books`、`PUT /api/books/:id`、`DELETE /api/books/:id` | 库的创建、更新、删除 | B |
| `POST /api/book_stacks`、`PUT /api/book_stacks/:id`、`PUT /api/book_stacks/:id/sort` | 集合管理与排序 | B |

没有执行表中的写请求。HTTP 方法来自 `common` 的请求包装函数，不是根据 REST 风格猜测。

## 6. 目录操作的代码设计

### 6.1 命令而不是任意覆盖字段

服务层枚举定义了 `prependChild / appendChild / moveAfter / moveBefore / insert / insertAfter / insertSibling / remove / removeWithChildren / destroy / destroyWithChildren / edit`，以及按文档集合插入、同步文档等命令。

`beforeCatalogNodesUpdateOffline` 读取：

```text
book_id、action、node_uuid、target_uuid、doc_id、title
```

据此重建的调用形状如下；这是阅读代码后的示意，未实际发送：

```json
{
  "book_id": "book-id",
  "action": "prependChild",
  "node_uuid": "node-to-move",
  "target_uuid": "new-parent"
}
```

批量移动/复制调用包含 `batch_action / node_uuids / book_id / target_book_id / target_uuid / transfer_action / insert_to_catalog`，响应代码使用 `data` 更新目录、使用 `meta.affectedDocIds` 处理受影响文档。

### 6.2 客户端树变换

服务层节点创建代码初始化独立 UUID、连接字段、类型、文档引用及显示字段。插入代码会维护父节点的 `child_uuid`、已有节点的 `prev_uuid` 和新节点的 `sibling_uuid`；移动会脱离原连接，再插入目标位置，并调整后代层级及扁平数组顺序。

目录渲染组件读取 `depth / item / provided / snapshot / isExpanded / hasChildren`，使用拖动相关 props 与组合目标状态。可以确认存在拖动树渲染设计，未通过实际拖动验证完整交互，也未完整追踪其控制器或确认第三方拖拽库名称。

`remove` 与 `destroy`、带后代与不带后代操作分别命名。说明目录移除与文档删除需要明确区分；准确服务端级联规则仍需写操作或服务端文档才能核验。

## 7. 目录历史与离线同步

### 7.1 目录历史单独建模

`c__BookManage` 通过 `versions.find({ item_type: "BookToc", item_id, limit: 200, exclude_object: true })` 拉列表，再取版本详情并解析目录树。恢复调用 `catalogNodes.revert({ book_id, version_id })`，成功后重载页面。

当前账号历史为空，因此只确认了读取入口、请求以及代码中的恢复流程；没有验证恢复效果、留存周期或快照触发条件。

### 7.2 在线/离线服务钩子

`c__service-data-layer` 明确存在：

- `beforeCatalogNodesUpdateOnline`。
- `afterCatalogNodesUpdateOnline`。
- `beforeCatalogNodesUpdateOffline`。
- 对 `catalogNodes.find / update` 挂接 online/offline、before/after 的钩子。
- 本地 `Book.findOne / save` 与待同步知识库集合。

在线更新后，代码在没有本地待同步目录的条件下将返回目录写入本地 Book。离线更新则本地变换目录，记录 `toc_updated_at` 并将知识库加入待同步集合。

离线同步调用参数为 `book_id / local_book_toc / local_book_toc_time`。响应分支检查 `meta.needUpdate`，使用返回的 `data` 和 `meta.toc_updated_at` 更新本地。冲突提示文案写明离线操作的目录保存为历史版本，可在目录管理查看。

**已确认客户端有保留冲突目录的设计；服务端如何比较、合并和生成历史未确认。** 不能据这段代码声称采用 CRDT、OT 或某种时间戳优先算法。

## 8. 对 snotes 的启发

1. 保留笔记正文实体，让目录节点独立引用笔记，避免目录排序改动正文版本。
2. 将知识库列表、知识库首页、目录树、文档管理分开，避免一个巨大组件承担所有操作。
3. 目录排序是结构变更，应有单独版本与快照；现有正文历史不能代替目录历史。
4. 首页可组合简介与文档列表，第一版不必复制 Lake、发布系统及完整 Doclet 机制。
5. 用户已明确当前不需要权限管理和协作。snotes 方案只采用个人知识库，沿用现有实例访问令牌；报告中的语雀权限和协作内容是调研事实，不属于 snotes 的开发范围。
6. 新功能应接入本地存储、增量同步和完整备份，而不只是画一棵树。

具体数据模型、同步方案、删除边界和实施范围见配套设计草案。

## 9. 可复核的静态代码来源

以下文件均来自本次浏览实际加载的资源，而非猜测 URL。基址为：

`https://gw.alipayobjects.com/os/chair-script/skylark/`

| 文件 | SHA-256 |
| --- | --- |
| [common.2ef32621.js](https://gw.alipayobjects.com/os/chair-script/skylark/common.2ef32621.js) | `a6496ef802dba0c76d771787e2e4986011b2de91a134ea9901de813bb81e884b` |
| [pc.3aa5c457.js](https://gw.alipayobjects.com/os/chair-script/skylark/pc.3aa5c457.js) | `268af753a43f6d8cbba8a6d2eed09818b415284ce71c5bd4a7b51c633edb22dd` |
| [c__service-data-layer.5fb87b4b.async.js](https://gw.alipayobjects.com/os/chair-script/skylark/c__service-data-layer.5fb87b4b.async.js) | `fa69955653176f0a6748aad8fd88f62782ad15b93a36c151602557bab38f1ce1` |
| [c__DashboardBooks.d99bdd6a.async.js](https://gw.alipayobjects.com/os/chair-script/skylark/c__DashboardBooks.d99bdd6a.async.js) | `547b8ef5f3eb77434f5c3bac1660621bfd203c723823063657ac86635a283dcc` |
| [c__CatalogModule.dfbe62e1.async.js](https://gw.alipayobjects.com/os/chair-script/skylark/c__CatalogModule.dfbe62e1.async.js) | `83d5b32ae630d19fdeca51fec2514250fb857442567a0eebcf9fb45fcf7f4945` |
| [c__BookOverview.813cefff.async.js](https://gw.alipayobjects.com/os/chair-script/skylark/c__BookOverview.813cefff.async.js) | `e0a74ba9f2d2da06ac707c28496c6b3b68aa1c48f5f4148a36fa688feecb2e3a` |
| [c__BookManage.19d836eb.async.js](https://gw.alipayobjects.com/os/chair-script/skylark/c__BookManage.19d836eb.async.js) | `f937190fa10093ad4c0a18b88b07101132a682a8a2354af258a528a66fc01714` |
| [c__DocActionMenu.ef750a1f.async.js](https://gw.alipayobjects.com/os/chair-script/skylark/c__DocActionMenu.ef750a1f.async.js) | `4c3c7870a6fccf249df5814c42ff33fd091798962f1736c7b115ff2af3ba2506` |

搜索定位词：`namespace:"book"`、`refreshDocsAndToc`、`parent_uuid`、`beforeCatalogNodesUpdateOffline`、`local_book_toc`、`BookToc`、`catalogNodes.revert`、`batch_action`。

没有将整套第三方 bundle、原始登录信息、账号响应或文档正文加入项目。上表用于复核本报告的技术事实，资源哈希不代表原始源码版本号。
