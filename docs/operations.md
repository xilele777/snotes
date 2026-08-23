# snotes 运维手册

## 令牌与图片

普通 API 只接受 `Authorization: Bearer <token>`。图片 `<img>` 请求不能附加请求头，因此前端额外写入 `snotes_token` Cookie，作用域严格限定为 `/api/images/`，不会用于写操作。

图片破图时检查 Cookie 的 Path，并确认 R2 对象存在：

```bash
npx wrangler r2 object get snotes-images/<note-id>/<file> --file /tmp/image
```

## 备份与恢复

每月导出一次 D1：

```bash
npx wrangler d1 export snotes --remote --output backup-$(Get-Date -Format yyyyMM).sql
npx wrangler d1 execute snotes --remote --file backup-YYYYMM.sql
```

R2 图片由 Cloudflare 持久化保存；删除回收站前请先确认备份完成。

## 令牌轮换

```bash
npx wrangler secret put ACCESS_TOKEN
npm run deploy
```

旧令牌会在下一次请求返回 401，本地 IndexedDB 不受影响，重新输入新令牌即可继续同步。

## 数据库迁移

新增 `migrations/0002_description.sql` 后先执行 `npx wrangler d1 migrations apply snotes --local` 并跑测试，再使用 `--remote` 应用生产库。不要直接修改线上表结构。

## 同步排查

同步是本地优先的：编辑先写 IndexedDB，再由 outbox 异步推送。网络恢复、页面重新可见和 30 秒定时器都会触发同步。若任务持续失败，可在浏览器 Application → IndexedDB → `snotes` → `outbox` 查看 `failed=1` 的记录并修复令牌或请求数据后重试。
