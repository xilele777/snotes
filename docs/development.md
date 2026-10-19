# 开发与贡献

[返回文档首页](README.md)

项目统一使用 Node.js 24 LTS，`package.json` engines 与 CI 使用相同主版本。所有命令在仓库根目录执行。

## 本地开发

```bash
npm ci

# 首次开发时创建本地令牌配置
echo "ACCESS_TOKEN=dev-token" > .dev.vars

# 初始化本地数据库（本地库与线上库互不影响）
npx wrangler d1 migrations apply snotes --local

npm run dev:worker   # 终端 1：Worker 跑在 8787
npm run dev          # 终端 2：前端跑在 5173
```

打开 <http://localhost:5173>，输入 `dev-token` 进入。前端经 vite proxy 访问 8787 的 API，与生产同源形态一致。`.dev.vars` 已在 `.gitignore` 中，不会入库。

本地开发不需要真实的 D1/R2 资源，wrangler 会用本地模拟；因此这一步可以在还没改 `database_id` 的情况下进行。上面的 `.dev.vars` 创建命令仅用于首次初始化，已有文件请保留，不要覆盖自己的令牌或其他配置。

### 测试

```bash
npm test            # 前端与 shared 纯逻辑
npm run test:worker # Worker 集成测试（跑在真实 Workers 运行时里）
npm run test:server # 服务器 SQLite / 磁盘 / API 集成测试
npm run test:all    # 以上全部
npm run test:e2e    # Playwright 端到端
npm run test:e2e:server # 相同浏览器用例，改用 Node.js 服务
npm run typecheck   # 类型检查
npm run check:bundle # 生产构建后检查 main / Vditor / Lute 的 gzip 和解码体积预算
npm run profile:startup -- --runs 3 --output tmp/startup-profile.json
npm run profile:startup -- --runs 3 --large-note --output tmp/startup-large-profile.json
```

E2E 会自己构建、应用迁移并在 `8790` 端口拉起 `wrangler dev`，打的是生产形态（同源静态资源 + API），不需要手动先起服务。测试使用 `tests/e2e/wrangler.jsonc` 中的固定测试令牌，数据独立保存在 `tmp/e2e-state`。

服务器测试使用 Node.js 24；`test:e2e:server` 在 `8791` 端口启动真实 Node.js 服务，数据位于 `tmp/e2e-server-state`。两种 E2E 都构建到 `dist/`，请顺序执行。

提交前请跑通 `npm run test:all && npm run build`。

GitHub Actions 会运行全部单元/集成测试、生产构建、资源预算、生产依赖安全审计，以及 Worker/Node 两种后端的 Chromium E2E。浏览器矩阵在独立 runner 中执行；本地两套 E2E 需要顺序运行。性能 profile 使用 500 条合成笔记、390×844、4 倍 CPU 降速和 4 Mbps/40 ms，不访问生产数据；测量时避免并行构建或其他浏览器测试。长文用例为约 76,000 字符、2,000 段落。性能结果与体积预算用途不同，体积通过不能代替真实手机性能验收。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3、Pinia、Vditor（Markdown 编辑器）、Dexie（IndexedDB） |
| PWA | vite-plugin-pwa（Workbox） |
| 后端 | Hono，运行于 Cloudflare Workers 或 Node.js 24 |
| 存储 | Cloudflare D1 / R2，或 SQLite / 本地磁盘 |
| 测试 | Vitest（单元/集成）、Playwright（端到端） |

## 架构

```mermaid
flowchart LR
  UI[Vue / Markdown 编辑器] <--> Local[IndexedDB]
  Local <--> Sync[增量同步与任务队列]
  Sync <-->|同源 API| Worker[Hono API / Workers 或 Node.js]
  UI <-->|图片| Worker
  Worker <--> D1[D1 或 SQLite / 笔记与分组]
  Worker <--> R2[R2 或磁盘 / 图片]
```

- 数据 API 使用 `Authorization: Bearer <token>` 鉴权；图片请求支持同源 Cookie（`Path=/api/images/`），健康检查 `/api/health` 无需令牌。
- `/api/agent/v1` 与 `/api/mcp` 使用独立 Agent 凭证并按笔记本和操作权限授权；HTTP 与 MCP 共用领域服务。详见 [Agent 接入](agent-access.md)。
- 同步引擎在 `src/sync/`：`pull` 拉版本清单与缺失正文，`push` 消费 outbox 队列，`conflict` 处理并发冲突副本
- 数据库 schema 在 `migrations/`，前后端共用类型在 `shared/types.ts`

## 项目结构

```
src/            前端（Vue 3 + Pinia）
  components/    列表、详情、侧栏、监控等组件
  editor/        Vditor 编辑器封装
  stores/        Pinia 状态（notes / ui / groups）
  sync/          同步引擎（pull / push / conflict）
  db/            Dexie schema 与 repo
  api/           与 Worker 通信的客户端
  navigation.ts  视图、统计与设置页面和阅读位置的 History 导航
worker/         共用 Hono API 与 Cloudflare 入口
  routes/        notes / knowledge-bases / opens / groups / sync / trash / images / metrics
  metrics/       D1/R2/HTTP 指标采集
  auth.ts        Bearer + Cookie 鉴权中间件
server/         Node.js 入口、SQLite 与本地图片适配器
deploy/         systemd 与 HTTPS 反向代理示例
public/         图标等公开静态资源
scripts/        构建服务端与生成图标等工具
shared/         前后端共用类型与逻辑（同步归并、排序、清洗）
migrations/     D1 / SQLite 数据库迁移
tests/          端到端、Worker 集成、单元测试与 setup
docs/           设计文档、运维手册
```

## 根目录如何组织

根目录保留项目入口、包管理、构建/测试配置及部署入口；业务实现继续按 `src/`、`worker/`、`server/`、`shared/` 分层。详细文档放在 `docs/`，运维样例放在 `deploy/`，脚本放在 `scripts/`。

- `package.json`、锁文件、`index.html`、Vite/TypeScript/Vitest/Playwright 配置由工具直接读取，不应只为减少文件数量而移动。
- `Dockerfile`、`compose.yaml`、`server.env.example`、`wrangler.jsonc` 是部署入口。移动它们需要同步修改构建上下文、相对路径、脚本和文档。
- `node_modules/`、`dist/`、`dist-server/`、`.wrangler/`、`test-results/`、`tmp/` 等属于已忽略的本地产物，不是 GitHub 首页中的源码目录；服务或工具运行时不要删除。
- 环境文件、数据库和 `backups/` 可能包含真实数据，不属于可随意清理的垃圾。
- 无关演示页、截图或实验文件应先确认用途，再归档到单独的实验目录；不要混入 `public/`，该目录会随应用公开发布。

## 贡献代码

欢迎 issue 与 PR。提交前请注意：

- 先跑通 `npm run test:all && npm run build`
- Commit 信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，格式见 [CLAUDE.md](../CLAUDE.md)
- 数据库 schema 变更一律新增 `migrations/000N_*.sql` 递增迁移，不改动已有迁移文件；迁移编号与应用版本号是两套独立序列
- 版本号唯一来源是根目录 `package.json` 的 `version`，发布流程见 [CLAUDE.md](../CLAUDE.md)
- 行为变更请附对应测试

## 编辑器迁移与恢复协议

生产编辑器统一为 `src/editor/VditorEditor.vue`；旧 Milkdown 实现、专属组件、样式和依赖已移除。历史设计文档保留当时决策，不应直接复制旧文件路径。历史正文的空行兼容转换继续由 shared/sanitize 处理。加载期间只显示稳定提示，不渲染原始正文，初始化根隐藏且 inert，就绪后统一显示。

`0010_sync_checkpoints.sql` 新增短期同步凭证。新客户端在上传前验证凭证；过期、缺失或 watermark 回退时先从零对账，分页和正文全部成功且远端水位稳定才处理失踪记录并保存新游标。已确认墓碑直接删除，未确认输入保留副本；缺失记录无法区分删除和备份回退，正文保留为恢复副本。笔记本恢复使用独立持久标记，失败后仍先拉取再上传。凭证不等价于跨表快照，恢复数据库后应清空 sync_checkpoint，完整边界见修复记录。

备份导入先校验索引和正文、准备图片，再以同一个 IndexedDB 事务提交分组、笔记、目录、历史和待同步任务。同 ID 正文差异保留到历史供人工恢复。网络图片上传不属于本地事务；已上传的不可变图片凭证用于同一索引备份重试。
