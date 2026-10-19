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

优先到设置 → 数据查看最近错误、下载任务数据或显式重试。不要直接删除尚未备份的正文任务。服务器恢复备份或设备长期离线后，检查点失效会触发完整对账；本地未确认正文受到保护，差异正文保留到历史或独立恢复副本。

新版服务需要新增迁移 `0010_sync_checkpoints.sql`、`0011_sync_instance.sql`。检查点保留 7 天，短于墓碑保留期；旧备份中不存在的检查点会阻止客户端先上传旧任务。服务端数据库与图片仍应一起备份。图片永久回收当前暂缓，已删笔记的图片也可能仍可通过已知地址读取；这保护共享和离线引用，但会增加存储占用，不能把删除笔记等同于擦除图片对象。

## 每月备份

按数据的重要程度安排备份，至少在升级和恢复前另存一份。D1 导出示例（Bash；PowerShell 可将日期替换为实际字符串）：

```bash
npx wrangler d1 export snotes --remote --output "backup-$(date +%Y%m).sql"
```

SQL 只包含已经同步到 D1 的数据，浏览器里尚未同步的修改不在其中。完整备份还需单独保存 R2 图片对象；存储冗余不能替代备份。

R2 全量对象可通过 S3 兼容接口备份。先在 Cloudflare R2 创建仅对目标桶授权的 API 凭据，使用 AWS CLI 的私密 profile 保存，不写进仓库或 Wrangler vars：

```bash
aws configure --profile snotes-backup
# 输入 R2 Access Key ID / Secret Access Key，region 填 auto
aws s3 sync s3://snotes-images ../backups/r2-YYYYMM/ \
  --endpoint-url https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com --profile snotes-backup
```

停写后同时导出 SQL、同步全部对象，保存对象数量、大小与本地文件哈希供恢复核对。R2 凭据与应用 ACCESS_TOKEN 不同；不要把应用令牌填给 AWS CLI。备份目录应在私密磁盘上，不提交 Git。定期试恢复，不能只检查命令退出码。

D1 Time Travel 恢复示例（仅在确认目标及维护窗口后执行）：

```bash
npx wrangler d1 time-travel info snotes --json
# 将事先记录的恢复点 bookmark 填入下条命令
npx wrangler d1 time-travel restore snotes --bookmark YOUR_SAVED_BOOKMARK
```

如果使用 SQL 文件恢复，应先在新建空 D1 导入并核验，再切换 Worker 的数据库绑定；不要直接往正在使用的非空数据库重复执行整份建表 SQL。R2 恢复也建议创建独立空桶，用上述 S3 sync 的源与目标反向拷回并核对对象清单，再切换绑定。切换资源后同步更新监控 vars；保留原资源直到验收完成。配置使用独立文件时，每条 Wrangler 命令都追加同一个 `--config`。

恢复期间必须停写并排空在途请求，包括浏览器、Agent 和定时维护；先恢复数据及图片、应用所有迁移（含 `0011_sync_instance.sql`），再轮换数据库外的部署 epoch，最后开放访问。只恢复笔记本表也执行同样步骤。两个同步域分别签发 checkpoint，共用实例 epoch；表写入的 revision 触发器辅助识别同水位变化。完整快照会连 revision 和凭证一起回滚，因此仍必须执行恢复钩子，不能仅凭数据库识别自身被恢复。

Cloudflare 在维护窗口执行（显式传入目标配置）：

```bash
node scripts/rotate-sync-epoch.mjs path/to/wrangler.staging.jsonc
```

若配置 vars 已含 `SYNC_REQUIRE_EPOCH: "true"`，命令追加 `--strict-enabled`，避免同名 secret 冲突；否则工具先开启 `SYNC_REQUIRE_EPOCH=true`，再轮换 Worker Secret `SYNC_INSTANCE_EPOCH`；每次 secret 更新会部署配置。可以再清空 `sync_checkpoint` 回收空间。恢复后不带 epoch 的旧 PWA 写入返回 409，需升级后恢复上传；先保留旧页面并导出未同步内容。正常兼容部署可以暂不启用严格模式，恢复实例必须启用。

Node 完整实例备份/恢复（先停服；目标目录必须不存在，工具拒绝覆盖）：

```bash
node scripts/instance-backup.mjs backup data backups/instance-20261019 --offline
node scripts/instance-backup.mjs restore backups/instance-20261019 data-restored --offline
```

备份包含 SQLite 全部业务表（含云端历史、全部回收站及授权数据）和 images 目录全部文件，包括无引用图片；核验数据库完整性，使用 VACUUM INTO 处理 WAL，再复制图片并记录 SHA-256 清单。恢复先核验清单/哈希/外键，复制到新目录，轮换数据库及文件 epoch，清空两个域凭证并写入严格客户端标记。把 `SNOTES_DATA_DIR` 指向新目录再启动。`--offline` 是操作者已停止写入的声明，工具不会替你停止服务；备份含授权数据，应私密保存。如配置了 `SYNC_INSTANCE_EPOCH` 环境变量，也应更换。Docker 镜像包含同一工具，可在停应用容器后用挂载数据卷的临时容器执行。

完整清单下载并核验成功才处理缺失项；远端缺失的已确认笔记本保留为独立恢复副本，未确认本地创建保留原队列。无法区分过期删除与备份之后创建的内容，可能需要人工合并。跨请求再次恢复会拒绝旧 epoch 写入；正在执行的请求仍必须靠维护窗口排空，此流程不承诺在线无停机恢复。

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

应用启动时检查 GitHub 最新稳定版 Release，成功结果缓存 24 小时；检测到新版本时，侧栏「设置」出现蓝点，在「关于」页查看版本和升级说明。先阅读 [CHANGELOG](../CHANGELOG.md)、备份 D1 与 R2，并按 [Cloudflare 升级步骤](cloudflare-deployment.md#8-更新到新版本)保存个人部署配置、更新代码、恢复配置并解决冲突，然后执行：

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
