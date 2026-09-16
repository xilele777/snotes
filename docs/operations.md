# snotes 运维手册

服务器部署的启动、升级、备份和恢复见[服务器部署文档](server-deployment.md)。下文的 D1/R2、Wrangler 和 Cloudflare 密钥操作仅适用于 Cloudflare 部署；令牌、同步和浏览器排查适用于两种部署。

## 令牌是怎么用的

令牌同时存在两个地方，缺一不可：

- `localStorage`：所有 API 请求经 `Authorization: Bearer` 头带上它
- Cookie `snotes_token`，`Path=/api/images/`、`SameSite=Strict`：只为 `<img>` 存在

原因是 `<img src>` 由浏览器直接发起，无法附加自定义请求头。Cookie 的 `Path`
必须限定在图片路径上——放成 `Path=/` 会让令牌附在每一个请求上，
既作废了「令牌只走 Authorization 头」这条约束，也引入 CSRF 面。

排查图片显示不出来时，先看这个 Cookie 是否存在、Path 是否正确。

## 同步失败列表

推送任务遇到不可重试的 4xx（例如请求体被服务端判为非法）时不会被丢弃，
而是在 outbox 里标记 `failed=1` 并停止重试，界面上以待处理数量呈现。

在开发者工具的 Console 里查看：

```js
const db = await indexedDB.databases()
// 或直接在 Application → IndexedDB → snotes → outbox 中按 failed 字段筛选
```

处理方式二选一：确认内容不重要就直接删除该行；仍需要就把 `failed` 改回 `0`、
`retry` 改回 `0`，下一轮同步会重试。

## 每月备份

个人项目不需要自动化流水线，每月手动执行一次即可：

```bash
npx wrangler d1 export snotes --remote --output "backup-$(date +%Y%m).sql"
```

SQL 只包含已经同步到 D1 的数据，浏览器里尚未同步的修改不在其中。完整备份还需单独保存 R2 图片对象；存储冗余不能替代备份。

恢复时：

```bash
npx wrangler d1 execute snotes --remote --file backup-YYYYMM.sql
```

## 更换访问令牌

令牌泄露时的补救措施：

```bash
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
npx wrangler secret put ACCESS_TOKEN
```

已有 Worker 时，`wrangler secret put` 会创建并立即部署带新密钥的版本；同时修改了代码时再运行 `npm run deploy`。

所有客户端会在下次请求时收到 401 并自动回到令牌输入页，重新输入新令牌即可。
本地数据不受影响。

## 升级到新版本

应用启动时，左下角版本按钮检查 GitHub 最新 Release，成功结果缓存 24 小时；检测到新版本会出现蓝点。先阅读 CHANGELOG、备份 D1 与 R2，并按 [README 的升级步骤](../README.md#8-更新到新版本)保存个人部署配置、拉取新代码、恢复配置并解决冲突，然后执行：

```bash
npm ci
npx wrangler d1 migrations apply snotes --remote   # CHANGELOG 提到新迁移时必须执行
npm run deploy
```

- 不要用 `skip-worktree` 规避配置冲突。恢复配置时手动保留自己的资源标识并合入上游字段；数据库改名后也要修改迁移命令中的 `snotes`。fork 用户还需先同步原仓库更新。
- 部署失败时先确认线上仍在运行的版本；已部署的 Worker 可在 Dashboard → Workers → Deployments 回滚。已经成功执行的数据库迁移不会随代码回滚，需检查 schema 兼容性，必要时按备份恢复。
- 版本检查失败（离线、GitHub 不可达）只会静默跳过，不影响笔记功能。

## 数据库迁移

schema 变更一律通过迁移文件，不手工改库：

```bash
# 新增迁移文件，命名递增：migrations/0002_xxx.sql
npx wrangler d1 migrations apply snotes --local    # 先在本地验证
npm run test:worker                                 # 跑一遍 Worker 测试
npx wrangler d1 migrations apply snotes --remote   # 再上生产
```

## 额度监控

用量监控组件和 `/api/metrics` 保留，当前侧栏不显示入口。配置完成后按以下周期对照 Cloudflare 免费额度：

- **每日额度**：D1 行读取、D1 行写入、Workers 请求。页面用本月最高单日判断是否曾经超过每日上限，并单独显示今日用量。
- **自然月额度**：R2 Class A / Class B 操作。页面按 UTC 自然月累计判断。
- **存储快照**：R2 当前存储。页面按最新快照预估，账单通常按存储月均值计算。
- **80% 预警**：任一判定口径达到或超过 80% 会标记为接近上限；超过 100% 才是已超出。

页面一次读取自然月至今的 Analytics 数据，近 7 天趋势只作为折叠后的辅助明细。

## 常见问题

**手机上笔记不见了**
iOS 在存储压力下会清理 IndexedDB。服务端始终保有完整副本，
重新打开应用会自动冷启动全量拉取，稍等即可恢复。

**同步不动了**
打开开发者工具看 `ui.lastSyncError`。最常见的原因是令牌失效（401），
此时应用会自动回到令牌输入页。若界面提示有失败任务，见上面的「同步失败列表」。

**图片显示为破图**
检查 `snotes_token` Cookie 是否存在、`Path` 是否为 `/api/images/`。
清空令牌重新输入一次即可重建。

**某条笔记出现了「（冲突副本）」**
说明两端在离线状态下同时编辑了这条笔记。较新的那次写入胜出，
被覆盖的版本保存成了这条副本。人工合并后删掉副本即可。
