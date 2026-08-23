# snotes 运维手册

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

把导出的 SQL 文件存到任意云盘。图片在 R2 中已有冗余，不单独备份。

恢复时：

```bash
npx wrangler d1 execute snotes --remote --file backup-YYYYMM.sql
```

## 更换访问令牌

令牌泄露时的补救措施：

```bash
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
npx wrangler secret put ACCESS_TOKEN
npm run deploy
```

所有客户端会在下次请求时收到 401 并自动回到令牌输入页，重新输入新令牌即可。
本地数据不受影响。

## 数据库迁移

schema 变更一律通过迁移文件，不手工改库：

```bash
# 新增迁移文件，命名递增：migrations/0002_xxx.sql
npx wrangler d1 migrations apply snotes --local    # 先在本地验证
npm run test:worker                                 # 跑一遍 Worker 测试
npx wrangler d1 migrations apply snotes --remote   # 再上生产
```

## 额度监控

免费额度对个人用量有两个数量级的余量，正常不需要关注。
若要检查，在 Cloudflare Dashboard 查看 Workers 的请求数与 D1 的读写行数。

按最激进估算（每天 480 次前台轮询 + 200 次编辑推送 ≈ 700 次请求/天），
距 10 万次/天的线仍有两个数量级余量。

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
