# snotes

本地优先的个人 Markdown 便签。前端是 Vue 3 + Dexie，后端是 Cloudflare Workers/Hono，数据使用 D1，图片使用私有 R2。

## 开发

```bash
npm install
npx wrangler d1 migrations apply snotes --local
npm run dev:worker   # http://localhost:8787
npm run dev          # http://localhost:5173
```

开发令牌写在 `.dev.vars`：`ACCESS_TOKEN=dev-token`。生产环境使用 `wrangler secret put ACCESS_TOKEN`。

## 验证

```bash
npm run typecheck
npm test
npm run test:worker
npm run build
```

## 部署

```bash
npx wrangler d1 migrations apply snotes --remote
npm run deploy
```

详细的令牌轮换、备份、迁移和图片排错步骤见 [运维手册](docs/operations.md)；代码分层与数据流见 [实现说明](docs/implementation.md)。设计与实施依据见 `docs/superpowers/`。
