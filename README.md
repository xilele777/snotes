# snotes

本地优先的个人 Markdown 便签，跑在 Cloudflare 免费额度内。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

所有数据先写进浏览器的 IndexedDB，界面响应与网络无关，断网完全可用；后台 Worker 做增量同步与图片存储。单用户、单 Cloudflare 账号即可自托管，不依赖任何第三方服务。

## 特点

- **离线优先** —— 所有读写先落 IndexedDB，断网完全可用，联网后自动增量同步
- **纯 Markdown** —— 内容永远不会被锁在私有格式里，导出即纯文本
- **增量同步** —— 版本清单先行，改星标/置顶不重传正文，多设备互通
- **图片直传** —— 粘贴即上传到 R2，`<img>` 经同源 Cookie 鉴权，离线可看图
- **PWA** —— 可安装到桌面 / 手机主屏，移动端像便签一样打开即目录页，系统返回键可直接退出
- **单 Worker** —— 前端与 API 同域同源，无 CORS，同进程提供静态资源与 API
- **冲突副本** —— 两端离线并发编辑同一笔记时，被覆盖的版本自动保存为副本，不丢内容
- **数据监控** —— 内置 D1 / R2 / HTTP 指标面板，直观查看用量

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3、Pinia、Milkdown（Markdown 编辑器）、Dexie（IndexedDB） |
| PWA | vite-plugin-pwa（Workbox） |
| 后端 | Cloudflare Workers、Hono |
| 存储 | Cloudflare D1（元数据/正文）、R2（图片） |
| 测试 | Vitest（单元/集成）、Playwright（端到端） |

## 架构

```
浏览器
  ┌────────────────────────────────────────────┐
  │ Vue SPA (Milkdown 编辑器)                    │
  │ IndexedDB ←→ 本地优先读写 (Dexie)             │
  │ Outbox 任务队列 → 后台增量推送                 │
  └───────────────────┬────────────────────────┘
                      │ 同源 fetch (Bearer / Cookie)
                      ▼
        单个 Cloudflare Worker
        ┌────────────────────────────────┐
        │ 静态资源 (dist)  +  Hono API      │
        │   /api/notes    /api/sync/*       │
        │   /api/groups   /api/trash/*      │
        │   /api/images/* /api/metrics/*    │
        └──────┬─────────────────────┬─────┘
               ▼                     ▼
            D1 (笔记)              R2 (图片)
```

- 所有 API 走 `Authorization: Bearer <token>` 鉴权；唯一例外是 `<img>`，由同源 Cookie（`Path=/api/images/`）兜底
- 同步引擎在 `src/sync/`：`pull` 拉版本清单与缺失正文，`push` 消费 outbox 队列，`conflict` 处理并发冲突副本
- 数据库 schema 在 `migrations/`，前后端共用类型在 `shared/types.ts`

## 快速开始

### 前置条件

- Node.js（推荐 20+）
- 一个 Cloudflare 账号（D1 与 R2 均有免费额度）
- `wrangler` 已登录：`npx wrangler login`

### 本地开发

```bash
npm install
npx wrangler d1 migrations apply snotes --local
npm run dev:worker   # 终端 1，Worker 在 8787
npm run dev          # 终端 2，前端在 5173
```

前端经 vite proxy 访问 8787 的 API，与生产同源。

本地开发令牌写在 `.dev.vars`（该文件不入库）：

```
ACCESS_TOKEN=dev-token
```

### 测试

```bash
npm test            # 前端与 shared 纯逻辑
npm run test:worker # Worker 集成测试（跑在 Workers 运行时里）
npm run test:all    # 以上全部
npm run test:e2e    # Playwright 端到端
```

## 部署

```bash
# 1. 设置访问令牌（首次，设一个 32 字节以上的随机串）
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
npx wrangler secret put ACCESS_TOKEN

# 2. （可选）监控页需要的指标读取权限
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN   # 需 Account > Analytics > Read

# 3. 应用数据库迁移
npx wrangler d1 migrations apply snotes --remote

# 4. 构建 + 部署
npm run deploy
```

部署成功后访问 Worker 域名，首次输入 `ACCESS_TOKEN` 即可进入。可安装到桌面 / 手机主屏作为独立应用使用。

> 监控页的 HTTP 请求量卡片还需要 `CF_ZONE_ID`（需 Zone > Analytics > Read 权限），不配置时该卡片不显示，不影响其余功能。

## 数据备份与迁移

```bash
# 导出（建议每月手动一次）
npx wrangler d1 export snotes --remote --output "backup-$(date +%Y%m).sql"

# 恢复
npx wrangler d1 execute snotes --remote --file backup-YYYYMM.sql
```

图片存储在 R2，本身有冗余，不需单独备份。

## 项目结构

```
src/            前端（Vue 3 + Pinia）
  components/    列表、详情、侧栏、监控等组件
  editor/        Milkdown 编辑器封装
  stores/        Pinia 状态（notes / ui / groups）
  sync/          同步引擎（pull / push / conflict）
  db/            Dexie schema 与 repo
  api/           与 Worker 通信的客户端
  navigation.ts  移动端 History 导航栈
worker/         Cloudflare Worker（Hono API）
  routes/        notes / groups / sync / trash / images / metrics
  metrics/       D1/R2/HTTP 指标采集
  auth.ts        Bearer + Cookie 鉴权中间件
shared/         前后端共用类型与逻辑
migrations/     D1 数据库迁移
tests/          端到端、Worker 集成、单元测试与 setup
docs/           设计文档、运维手册
```

## 文档

- [设计文档](docs/superpowers/specs/2026-08-22-snotes-design.md)
- [实施计划](docs/superpowers/plans/2026-08-22-snotes.md)
- [运维手册](docs/operations.md)
- [变更记录](CHANGELOG.md)

## 开发指南

- 版本号唯一来源是根目录 `package.json` 的 `version` 字段，发布流程见 [CLAUDE.md](CLAUDE.md)
- 数据库 schema 变更一律通过 `migrations/000N_*.sql` 递增迁移，编号独立于应用版本号
- 提交前请运行 `npm run test:all && npm run build`

## 许可证

MIT
