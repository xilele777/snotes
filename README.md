# snotes

本地优先的个人 Markdown 便签，跑在 Cloudflare 免费额度内。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

中文 | [English](README.en.md)

所有数据先写进浏览器的 IndexedDB，界面响应与网络无关，断网完全可用；后台 Worker 做增量同步与图片存储。单用户、单 Cloudflare 账号即可自托管，不依赖任何第三方服务。

## 特点

- **离线优先** —— 所有读写先落 IndexedDB，断网完全可用，联网后自动增量同步
- **纯 Markdown** —— 内容永远不会被锁在私有格式里，导出即纯文本
- **增量同步** —— 版本清单先行，改星标/置顶不重传正文，多设备互通
- **图片直传** —— 粘贴即上传到 R2，`<img>` 经同源 Cookie 鉴权，离线可看图
- **PWA** —— 可安装到桌面 / 手机主屏，移动端像便签一样打开即目录页，系统返回键可直接退出
- **单 Worker** —— 前端与 API 同域同源，无 CORS，同进程提供静态资源与 API
- **冲突副本** —— 两端离线并发编辑同一笔记时，被覆盖的版本自动保存为副本，不丢内容
- **用量监控** —— 按官方周期对照 D1、R2 和 Workers 免费额度

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
  ┌──────────────────────────────────────────────┐
  │ Vue SPA (Milkdown 编辑器)                    │
  │ IndexedDB ←→ 本地优先读写 (Dexie)            │
  │ Outbox 任务队列 → 后台增量推送               │
  └───────────────────┬──────────────────────────┘
                      │ 同源 fetch (Bearer / Cookie)
                      ▼
        单个 Cloudflare Worker
        ┌──────────────────────────────────┐
        │ 静态资源 (dist)  +  Hono API     │
        │   /api/notes    /api/sync/*      │
        │   /api/groups   /api/trash/*     │
        │   /api/images/* /api/metrics/*   │
        └──────┬─────────────────────┬─────┘
               ▼                     ▼
            D1 (笔记)             R2 (图片)
```

- 所有 API 走 `Authorization: Bearer <token>` 鉴权；唯一例外是 `<img>`，由同源 Cookie（`Path=/api/images/`）兜底
- 同步引擎在 `src/sync/`：`pull` 拉版本清单与缺失正文，`push` 消费 outbox 队列，`conflict` 处理并发冲突副本
- 数据库 schema 在 `migrations/`，前后端共用类型在 `shared/types.ts`

## 部署到你自己的 Cloudflare 账号

整个应用是一个 Worker 加两个存储桶（D1 + R2），全部落在 Cloudflare 免费额度内。

### 0. 前置条件

- **Node.js 22.12 或更高版本**（wrangler 4 要求 `>=22.0.0`，vite 8 要求 `>=22.12.0`）
- **一个 Cloudflare 账号**，并且**已在控制台开通 R2**：进入 Dashboard → R2 按提示开通。未开通时第 2 步创建桶会失败。
- 登录 wrangler：

  ```bash
  npx wrangler login
  ```

### 1. 克隆并安装

```bash
git clone https://github.com/xilele777/snotes.git
cd snotes
npm install
```

### 2. 创建 D1 数据库与 R2 桶

```bash
npx wrangler d1 create snotes
npx wrangler r2 bucket create snotes-images
```

第一条命令会打印一段配置片段，其中的 `database_id` 是**你自己账号的**，下一步要用：

```
[[d1_databases]]
binding = "DB"
database_name = "snotes"
database_id = "你的-数据库-uuid"
```

> 想换名字请看下面的[改名与自定义域名](#改名与自定义域名)。现在保持默认名最省事。

### 3. 把 database_id 填进 wrangler.jsonc（必做）

仓库里的 `wrangler.jsonc` 带着原作者账号的数据库 ID，**不改这一步部署必然失败**。需要替换的是**两处**：

```diff
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "snotes",
-      "database_id": "66325ab4-c335-4976-9a62-b0c9e5e21e97",
+      "database_id": "第 2 步返回的你自己的 uuid",
       "migrations_dir": "migrations"
     }
   ],
   ...
   "vars": {
-    "D1_DATABASE_ID": "66325ab4-c335-4976-9a62-b0c9e5e21e97",
+    "D1_DATABASE_ID": "同一个 uuid",
     "R2_BUCKET_NAME": "snotes-images"
   }
```

两处的值相同但用途不同：`d1_databases[].database_id` 是运行时数据库绑定，缺它应用起不来；`vars.D1_DATABASE_ID` 只给用量监控页查询 Analytics 用，填错不影响笔记功能，但监控页会读不到 D1 数据。这两个 ID 和桶名都不是机密，可以放心提交进仓库。

### 4. 设置访问令牌

这是保护你笔记的唯一凭据，请用随机串，不要用生日或常见密码：

```bash
# 生成一个 32 字节随机令牌
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"

# 把它写进 Worker 密钥（命令会提示粘贴）
npx wrangler secret put ACCESS_TOKEN
```

`ACCESS_TOKEN` 必须以密钥形式存在，**不要写进 `wrangler.jsonc` 的 `vars`**——那里的内容是明文配置，会随仓库一起公开。未设置时所有 API 一律返回 401。

### 5. 应用数据库迁移

```bash
npx wrangler d1 migrations apply snotes --remote
```

`--remote` 打的是线上库，`--local` 只影响本机开发库，两者互不相通。

### 6. 构建并部署

```bash
npm run deploy
```

该命令等价于「类型检查 → vite 构建 → wrangler 部署」。成功后终端会给出一个形如 `https://snotes.<你的子域>.workers.dev` 的地址。

先做一次免鉴权冒烟检查：

```bash
curl https://snotes.<你的子域>.workers.dev/api/health
# 期望输出：{"ok":true}
```

`/api/health` 注册在鉴权中间件之前，不返回任何数据，专门用于部署后验活。

### 7. 首次使用

浏览器打开 Worker 地址，粘贴第 4 步的令牌即可进入。令牌存在浏览器本地，每台设备输入一次。

在手机 Safari / Chrome 里选择「添加到主屏幕」，即可作为独立 PWA 使用；桌面 Chrome / Edge 地址栏右侧有安装按钮。

### 可选：开启用量监控页

不配置也不影响记笔记，`/api/metrics` 会返回 503 与 `not_configured`，监控页显示未配置。

需要两个密钥：

```bash
npx wrangler secret put CF_ACCOUNT_ID   # Cloudflare 账号 ID，在 Dashboard 右侧栏
npx wrangler secret put CF_API_TOKEN    # 需要 Account > Analytics > Read 权限
npm run deploy                          # 密钥变更后重新部署使其生效
```

创建 API Token 的路径是 Dashboard → My Profile → API Tokens → Create Token → Custom token，权限只勾 **Account · Account Analytics · Read** 即可，不要给多余权限。

### 改名与自定义域名

想换 Worker 名、数据库名或桶名，改 `wrangler.jsonc` 中对应字段，并保证与你实际创建的资源一致：

| 字段 | 作用 | 对应命令 |
| --- | --- | --- |
| `name` | Worker 名，决定 `<name>.<子域>.workers.dev` | 无需预先创建 |
| `d1_databases[].database_name` | D1 数据库名 | `wrangler d1 create <名字>` |
| `r2_buckets[].bucket_name` | R2 桶名 | `wrangler r2 bucket create <名字>` |
| `vars.R2_BUCKET_NAME` | 监控页查询用，须与上一行一致 | —— |

改了数据库名之后，迁移命令里的名字也要跟着换：`wrangler d1 migrations apply <新名字> --remote`。

绑自定义域名：在 Cloudflare Dashboard → Workers & Pages → 选中该 Worker → Settings → Domains & Routes → Add Custom Domain。域名需要托管在同一个 Cloudflare 账号下。

### 部署故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 部署报 `Couldn't find DB` / D1 相关的 not found | 第 3 步的 `database_id` 没换成你自己的，或换错了一处 |
| `wrangler r2 bucket create` 失败 | 账号未开通 R2，先到 Dashboard → R2 完成开通 |
| 迁移报错找不到数据库 | 第 2 步没执行，或迁移命令里的数据库名与 `wrangler.jsonc` 不一致 |
| 打开页面反复要求输入令牌 | 令牌不匹配。重新 `wrangler secret put ACCESS_TOKEN` 后**必须再跑一次** `npm run deploy` |
| `/api/health` 通但笔记加载空白且报 401 | 同上，令牌不一致；浏览器端清空令牌重新输入 |
| 部署成功但没有 workers.dev 地址 | 账号的 workers.dev 子域被关闭了，去 Workers & Pages → Settings 启用，或直接绑自定义域名 |
| 图片破图、其他功能正常 | R2 桶名与 `wrangler.jsonc` 不一致；或 `snotes_token` Cookie 丢失，见[运维手册](docs/operations.md) |
| 监控页显示「未配置」 | 未设置 `CF_ACCOUNT_ID` / `CF_API_TOKEN`，或 Token 缺少 Account Analytics Read 权限 |
| Windows Git Bash 下交互式命令报 `stdin is not a tty` | `wrangler secret put` 这类需要输入的命令改用 PowerShell 或 CMD 执行，或在命令前加 `winpty` |

## 本地开发

```bash
npm install

# 令牌是必需的：未设置时 Worker 对所有 API 返回 401
echo "ACCESS_TOKEN=dev-token" > .dev.vars

# 初始化本地数据库（本地库与线上库互不影响）
npx wrangler d1 migrations apply snotes --local

npm run dev:worker   # 终端 1：Worker 跑在 8787
npm run dev          # 终端 2：前端跑在 5173
```

打开 <http://localhost:5173>，输入 `dev-token` 进入。前端经 vite proxy 访问 8787 的 API，与生产同源形态一致。`.dev.vars` 已在 `.gitignore` 中，不会入库。

本地开发不需要真实的 D1/R2 资源，wrangler 会用本地模拟；因此这一步可以在还没改 `database_id` 的情况下进行。

### 测试

```bash
npm test            # 前端与 shared 纯逻辑
npm run test:worker # Worker 集成测试（跑在真实 Workers 运行时里）
npm run test:all    # 以上全部
npm run test:e2e    # Playwright 端到端
npm run typecheck   # 类型检查
```

E2E 会自己执行 `npm run build` 并拉起 `wrangler dev`，打的是生产形态（同源静态资源 + API），不需要手动先起服务。

> **在代理环境下**：跑 E2E 前先 `unset HTTP_PROXY HTTPS_PROXY`。workerd 会因代理环境变量崩溃，表现为测试长时间挂起。

提交前请跑通 `npm run test:all && npm run build`。

## 免费额度

单人使用离免费额度上限很远。应用内「用量监控」页按官方周期对照下列数字（定义在 `worker/metrics/collect.ts`，Cloudflare 政策调整时改这一处）：

| 资源 | 免费额度 | 周期 |
| --- | --- | --- |
| D1 行读取 | 5,000,000 | 每天 |
| D1 行写入 | 100,000 | 每天 |
| Workers 请求 | 100,000 | 每天 |
| R2 Class A 操作（写） | 1,000,000 | 自然月 |
| R2 Class B 操作（读） | 10,000,000 | 自然月 |
| R2 存储 | 10 GB | 当前快照 |

监控页在任一口径达到 80% 时标记为接近上限，超过 100% 才算已超出。

## 数据备份与迁移

```bash
# 导出（建议每月手动一次）
npx wrangler d1 export snotes --remote --output "backup-$(date +%Y%m).sql"

# 恢复
npx wrangler d1 execute snotes --remote --file backup-YYYYMM.sql
```

笔记正文与元数据都在 D1，导出的 SQL 即完整备份。图片存储在 R2，本身有冗余，不需单独备份。

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
  routes/        notes / opens / groups / sync / trash / images / metrics
  metrics/       D1/R2/HTTP 指标采集
  auth.ts        Bearer + Cookie 鉴权中间件
shared/         前后端共用类型与逻辑（同步归并、排序、清洗）
migrations/     D1 数据库迁移
tests/          端到端、Worker 集成、单元测试与 setup
docs/           设计文档、运维手册
```

## 文档

- [设计文档](docs/superpowers/specs/2026-08-22-snotes-design.md)
- [实施计划](docs/superpowers/plans/2026-08-22-snotes.md)
- [运维手册](docs/operations.md) —— 令牌机制、同步失败排查、备份、常见问题
- [变更记录](CHANGELOG.md)

## 安全说明

这是**单用户自托管**应用，鉴权模型只有一个共享令牌，请在此前提下使用：

- 拿到 `ACCESS_TOKEN` 的人可以读写你的全部笔记与图片，没有多用户、分享或权限分级
- 令牌保存在浏览器 `localStorage`，另有一个作用域限定为 `Path=/api/images/` 的 Cookie 专供 `<img>` 使用
- 令牌泄露时，重新 `wrangler secret put ACCESS_TOKEN` 并部署即可作废旧令牌，所有客户端会收到 401 并回到输入页，本地数据不受影响
- 不要把令牌写进 `wrangler.jsonc`、`.env` 或任何会进仓库的文件

发现安全问题请通过 GitHub 的 [Security Advisory](https://github.com/xilele777/snotes/security/advisories/new) 私下报告，不要开公开 issue。

## 贡献

欢迎 issue 与 PR。提交前请注意：

- 先跑通 `npm run test:all && npm run build`
- Commit 信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，格式见 [CLAUDE.md](CLAUDE.md)
- 数据库 schema 变更一律新增 `migrations/000N_*.sql` 递增迁移，不改动已有迁移文件；迁移编号与应用版本号是两套独立序列
- 版本号唯一来源是根目录 `package.json` 的 `version`，发布流程见 [CLAUDE.md](CLAUDE.md)
- 行为变更请附对应测试

## 许可证

[MIT](LICENSE) © xilele777
