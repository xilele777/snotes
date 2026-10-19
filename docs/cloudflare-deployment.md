# Cloudflare 部署

[返回文档首页](README.md) · [English](cloudflare-deployment.en.md)

## 版本选择

以下安装命令固定到发布标签 `v1.0.0`。也可在 [Releases](https://github.com/xilele777/snotes/releases) 选择其他标签；`main` 可能包含尚未发布的改动。固定标签部署处于 detached HEAD，后续升级应先备份，执行 `git fetch origin --tags`，再 `git switch --detach <新版本标签>`，不要使用 `git pull` 或强制切换覆盖个人配置。


需要一个 Worker、一个 D1 数据库和一个 R2 桶。各产品提供免费额度，实际费用取决于用量，参见[免费额度](#免费额度)。

## 0. 前置条件

- **Node.js 24 LTS**（与项目声明、CI 和 Node.js 后端保持一致）
- **一个 Cloudflare 账号**，并且**已在控制台开通 R2**：进入 Dashboard → R2 按提示开通。未开通时第 2 步创建桶会失败。
- 登录 wrangler：

  ```bash
  npx wrangler login
  ```

## 1. 克隆并安装

```bash
git clone --branch v1.0.0 https://github.com/xilele777/snotes.git
cd snotes
npm ci
```

## 2. 创建 D1 数据库与 R2 桶

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

## 3. 把 database_id 填进 wrangler.jsonc（必做）

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

## 4. 设置访问令牌

这是保护你笔记的唯一凭据，请用随机串，不要用生日或常见密码：

```bash
# 生成一个 32 字节随机令牌
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"

# 把它写进 Worker 密钥（命令会提示粘贴）
npx wrangler secret put ACCESS_TOKEN
```

`ACCESS_TOKEN` 必须以密钥形式存在，**不要写进 `wrangler.jsonc` 的 `vars`**——那里的内容是明文配置，会随仓库一起公开。未设置时，除健康检查外的数据 API 返回 401。

## 5. 应用数据库迁移

```bash
npx wrangler d1 migrations apply snotes --remote
```

`--remote` 操作所选配置中的远端数据库，`--local` 只影响本机开发库，两者互不相通。新实例必须应用全部迁移；从 0.24.1 升级时新增 `0010_sync_checkpoints.sql`、`0011_sync_instance.sql`，先迁移，再部署匹配的前后端。不要修改已应用的迁移。

## 6. 构建并部署

```bash
npm run deploy
```

该命令等价于「类型检查 → vite 构建 → wrangler 部署」。成功后终端会给出一个形如 `https://snotes.<你的子域>.workers.dev` 的地址。

先做一次免鉴权冒烟检查：

```bash
curl https://snotes.<你的子域>.workers.dev/api/health
# 期望输出：{"ok":true}
```

`/api/health` 返回服务状态，不包含笔记或令牌，用于部署后验活。

部署后还应登录创建一条测试笔记、上传图片、刷新并从另一浏览器读取，确认鉴权和 D1/R2 均可用。保留终端返回的 Deployment/Version ID；这是部署标识，应用版本仍以 `package.json` 为准。构建中的 `public/_headers` 负责静态缓存头：带版本的脚本使用 immutable，HTML 与 `/sw.js` 使用 no-cache；自定义 CDN 或代理也应保留这些规则。

## 7. 首次使用

浏览器打开 Worker 地址，粘贴第 4 步的令牌即可进入。令牌存在浏览器本地，每台设备输入一次。

在手机 Safari / Chrome 里选择「添加到主屏幕」，即可作为独立 PWA 使用；桌面 Chrome / Edge 地址栏右侧有安装按钮。

## 8. 更新到新版本

仓库发布新版本后，手动部署的 Worker **不会自动更新**，需要在部署机上重新拉代码并部署。应用启动时查询 GitHub 最新稳定版 Release，成功结果缓存 24 小时：有新版本时图标栏「设置」出现蓝点，设置的「关于」页显示最新版本号、发布说明链接和更新步骤。若想收到发布通知，可在 GitHub 仓库页面点 **Watch → Custom → Releases**，并在 GitHub 通知设置中启用邮件。以下 `git pull` 步骤用于跟踪分支的部署；固定标签部署请改用上方的[标签升级步骤](#版本选择)。

先阅读 [CHANGELOG](../CHANGELOG.md)，按[运维手册](operations.md)备份数据，进入项目目录运行 `git status` 检查本地改动。**如果 `wrangler.jsonc` 有未提交的个人配置**，先在仓库外备份一份，再暂存到 Git stash：

```bash
git stash push -m "snotes deployment config" -- wrangler.jsonc
```

仅在确有配置改动时执行该命令，并记录输出确认已创建 stash；其他代码改动也应先妥善保存。如果以前设置过 `skip-worktree`，先执行 `git update-index --no-skip-worktree wrangler.jsonc` 再检查状态。`skip-worktree` 不是解决上游冲突的办法。

```bash
git pull --ff-only                                  # 拉取当前分支最新代码
```

如果刚才创建了配置 stash，接着执行 `git stash apply 'stash@{0}'` 恢复它（期间不要创建其他 stash）。有冲突时手动合并，保留自己的 Worker 名、两处数据库 ID 和桶名，同时合入上游新增字段；确认配置正确后再继续。stash 会保留，验收完成后可自行删除。使用 fork 且上游不在 `origin` 时，需要先把原仓库的更新同步到自己的分支；此处 `git pull` 只更新当前跟踪分支。

```bash
npm ci                                              # 按锁文件安装依赖
npx wrangler d1 migrations apply snotes --remote    # 有新迁移时执行；没有新迁移会直接返回
npm run deploy                                      # 构建并部署
```

数据库改过名时，迁移命令中的 `snotes` 也要替换。密钥（`ACCESS_TOKEN` 等）保存在 Cloudflare 侧，无需重新输入。部署完成后，保持联网等待浏览器下载新的 Service Worker 和缓存，再刷新或关闭所有应用窗口后重新打开，并在设置「关于」页核对版本号；离线或仍在使用旧缓存时不会立即变为新版。

从 0.24.1 及更旧版本首次升级到 1.0.0 前，先在每个旧标签页完成保存与同步，必要时导出备份，再关闭旧应用窗口。旧页面不具备新版的刷新前保存交接机制。1.0.0 开始，新版提示“保存并更新”，各新版标签页在控制器接管时先交接本地输入；本地保存失败时应恢复或下载草稿后再刷新。普通升级不需要轮换恢复 epoch；数据库或部分表恢复时必须执行下方恢复流程。

## 独立 staging 与验收

staging 必须有独立 Worker、D1、R2 和访问令牌，不能只换域名后继续绑定生产资源。在项目根目录创建不提交的 `wrangler.staging.local.jsonc`，可从 [staging 配置示例](../deploy/wrangler.staging.example.jsonc) 复制；`.local.jsonc` 中的数据库 ID 必须替换为下列创建命令的返回值：

```bash
npx wrangler d1 create snotes-acceptance-demo
npx wrangler r2 bucket create snotes-acceptance-demo
cp deploy/wrangler.staging.example.jsonc wrangler.staging.local.jsonc
# 编辑配置：填写自己的 account_id、database_id，并确保三个资源名一致
npx wrangler d1 migrations apply snotes-acceptance-demo --remote --config wrangler.staging.local.jsonc
npx wrangler secret put ACCESS_TOKEN --config wrangler.staging.local.jsonc
npm run build
npx wrangler deploy --config wrangler.staging.local.jsonc
```

Windows 使用 `Copy-Item` 代替 `cp`。测试环境的所有 Wrangler 命令都显式传 `--config`；`npm run deploy` 默认使用生产配置，不能用于上述 staging。示例不启用定时清理，严格 epoch 写入已开启；凭证与生产分开生成。批量、恢复与 CDN 验收的运行方式见[发布验收](release-acceptance.md)。恢复脚本会实际回滚该远端 D1，只可在可丢弃测试环境运行。

## 备份和数据库恢复

D1 导出或 Time Travel 仅恢复数据库，不包含 R2。完整实例备份需要在停止所有写入后保存 D1 和全部 R2 对象，并核对对象清单；应用内 ZIP 是合并导入，不能替代远端实例备份。已提交图片采用保留策略，删除笔记不擦除图片，会累积存储。

恢复整库、同水位快照或仅笔记本表时，都需维护窗口：停止浏览器、Agent、定时维护及其他写入，排空在途请求；恢复数据和图片，应用全部迁移，然后轮换数据库外的实例 epoch 并启用严格模式，再开放访问。只清空同步凭证不足以完成恢复。

```bash
# 目标配置中尚未设置 SYNC_REQUIRE_EPOCH 时，工具先创建严格模式 secret
node scripts/rotate-sync-epoch.mjs wrangler.jsonc
# 若配置的 vars 已明确包含 SYNC_REQUIRE_EPOCH: "true"，避免同名 secret 冲突
node scripts/rotate-sync-epoch.mjs wrangler.staging.local.jsonc --strict-enabled
```

以上两条按配置情况择一执行；第二条只适用于严格模式已生效的配置。工具会部署新的 Worker secret，须保持维护窗口直到生效。恢复后无 epoch 或旧 epoch 的所有者写入返回 409，旧 PWA 需升级；先导出旧页面未同步内容。Agent 写入仍需靠维护窗口停止并排空，不能把 epoch 当作在线无停机恢复锁。详细步骤与 Node 实例恢复工具见[运维手册](operations.md#每月备份)。

## 可选：配置用量监控 API

当前保留 `/api/metrics` 和监控组件，侧栏暂不显示监控入口。不配置不影响笔记与写作统计；调用未配置的用量接口会返回 503 与 `not_configured`。

需要两个密钥：

```bash
npx wrangler secret put CF_ACCOUNT_ID   # Cloudflare 账号 ID，在 Dashboard 右侧栏
npx wrangler secret put CF_API_TOKEN    # 需要 Account > Analytics > Read 权限
```

已有 Worker 时，`wrangler secret put` 会创建并立即部署含新密钥的版本；如果同时改了代码，再执行 `npm run deploy`。详见 [Wrangler secret 命令](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret)。

创建 API Token 的路径是 Dashboard → My Profile → API Tokens → Create Token → Custom token，权限只勾 **Account · Account Analytics · Read** 即可，不要给多余权限。

## 改名与自定义域名

想换 Worker 名、数据库名或桶名，改 `wrangler.jsonc` 中对应字段，并保证与你实际创建的资源一致：

| 字段 | 作用 | 对应命令 |
| --- | --- | --- |
| `name` | Worker 名，决定 `<name>.<子域>.workers.dev` | 无需预先创建 |
| `d1_databases[].database_name` | D1 数据库名 | `wrangler d1 create <名字>` |
| `r2_buckets[].bucket_name` | R2 桶名 | `wrangler r2 bucket create <名字>` |
| `vars.R2_BUCKET_NAME` | 监控页查询用，须与上一行一致 | —— |

改了数据库名之后，迁移命令里的名字也要跟着换：`wrangler d1 migrations apply <新名字> --remote`。

绑自定义域名：在 Cloudflare Dashboard → Workers & Pages → 选中该 Worker → Settings → Domains & Routes → Add Custom Domain。域名需要托管在同一个 Cloudflare 账号下。

## 部署故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 部署报 `Couldn't find DB` / D1 相关的 not found | 第 3 步的 `database_id` 没换成你自己的，或换错了一处 |
| `wrangler r2 bucket create` 失败 | 账号未开通 R2，先到 Dashboard → R2 完成开通 |
| 迁移报错找不到数据库 | 第 2 步没执行，或迁移命令里的数据库名与 `wrangler.jsonc` 不一致 |
| 打开页面反复要求输入令牌 | 确认浏览器输入与 Worker 的 `ACCESS_TOKEN` 一致；需要更换时使用 `wrangler secret put ACCESS_TOKEN` |
| `/api/health` 通但笔记加载空白且报 401 | 同上，令牌不一致；浏览器端清空令牌重新输入 |
| 部署成功但没有 workers.dev 地址 | 账号的 workers.dev 子域被关闭了，去 Workers & Pages → Settings 启用，或直接绑自定义域名 |
| 图片破图、其他功能正常 | R2 桶名与 `wrangler.jsonc` 不一致；或 `snotes_token` Cookie 丢失，见[运维手册](operations.md) |
| 监控页显示「未配置」 | 未设置 `CF_ACCOUNT_ID` / `CF_API_TOKEN`，或 Token 缺少 Account Analytics Read 权限 |
| Windows Git Bash 下交互式命令报 `stdin is not a tty` | `wrangler secret put` 这类需要输入的命令改用 PowerShell 或 CMD 执行，或在命令前加 `winpty` |

## 免费额度

费用取决于请求、数据库读写、图片存储和操作量，不保证所有使用方式都免费。最新额度与计费规则以官方文档为准：

- [Workers 计费](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 计费](https://developers.cloudflare.com/r2/pricing/)

可选用量监控的计算逻辑位于 `worker/metrics/collect.ts`；平台政策调整时需同步更新。
