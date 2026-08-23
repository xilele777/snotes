# 实现说明

## 数据流

Vue 组件只调用 Pinia store；store 通过 `src/db/repo.ts` 读写 Dexie。写入本地记录后立即合并一条 outbox 任务，`src/sync/engine.ts` 串行执行 push，再执行 pull。游标存储在 `meta.sync_cursor`，正文与列表元数据分开拉取。

## 服务端边界

`worker/index.ts` 只负责装配路由。业务逻辑分别位于 `worker/routes/`，共享的 Markdown 派生字段、游标和退避函数位于 `shared/`，避免前后端出现两套规则。D1 迁移文件是数据库结构的唯一来源。

## 安全约束

Worker 对所有 API（健康检查除外）校验 Bearer 令牌；只有图片读取允许受限 Cookie。R2 桶不公开，上传限制为允许的图片 MIME 且不超过 10 MB。Markdown 原始 HTML 会在进入渲染层前转义。

## 维护流程

改表先新增递增迁移，在本地执行迁移并运行 `npm run test:all`、`npm run typecheck`、`npm run build`，再应用到远端。同步问题优先查看 IndexedDB 的 `outbox` 和 `meta`，部署/备份/令牌轮换见 [operations.md](operations.md)。
