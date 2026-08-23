/// <reference types="@cloudflare/vitest-plugin/types" />

// `cloudflare:test` 导出的 `env` 类型是 `Cloudflare.Env`（见
// @cloudflare/vitest-plugin/types/cloudflare-test.d.ts）。该 namespace 在
// @cloudflare/workers-types 里声明为空 interface，项目通过 declare global
// 合并扩展它：补上 worker 的三个绑定 + 测试专用 TEST_MIGRATIONS。
// 文件含 `export {}` 因而是模块，必须用 `declare global` 才能与全局
// namespace Cloudflare 合并——直接 `declare namespace Cloudflare` 会被
// 当作模块内私有声明，合并不会发生。
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      R2: R2Bucket
      ACCESS_TOKEN: string
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
    }
  }
}

export {}
