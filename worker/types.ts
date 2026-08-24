export interface Env {
  DB: D1Database
  R2: R2Bucket
  ACCESS_TOKEN: string
  /** 监控页（Bug 8）用到的 CF 账号级信息。三个查询字段 */
  D1_DATABASE_ID?: string
  R2_BUCKET_NAME?: string
  /** 机密：`wrangler secret put CF_ACCOUNT_ID` / `CF_API_TOKEN` 注入，不进前端 */
  CF_ACCOUNT_ID?: string
  CF_API_TOKEN?: string
  /** 可选：配了才查询 HTTP 请求量，否则监控页 HTTP 卡片显示「未配置」 */
  CF_ZONE_ID?: string
}
