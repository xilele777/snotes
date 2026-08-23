# snotes

本地优先的个人 Markdown 便签，跑在 Cloudflare 免费额度内。

## 特点

- 所有读写先落 IndexedDB，界面响应与网络无关，断网完全可用
- 内容是纯 Markdown，永远不会被锁在私有格式里
- 增量同步：版本清单先行，改星标不重传正文
- 单个 Worker 同时提供前端与 API，同域无 CORS

## 开发

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

## 测试

```bash
npm test            # 前端与 shared 纯逻辑
npm run test:worker # Worker 集成测试（跑在 Workers 运行时里）
npm run test:all    # 以上全部
npm run test:e2e    # Playwright 端到端
```

## 部署

```bash
npx wrangler secret put ACCESS_TOKEN   # 首次，设一个 32 字节以上的随机串
npx wrangler d1 migrations apply snotes --remote
npm run deploy
```

## 文档

- [设计文档](docs/superpowers/specs/2026-08-22-snotes-design.md)
- [实施计划](docs/superpowers/plans/2026-08-22-snotes.md)
- [运维手册](docs/operations.md)
