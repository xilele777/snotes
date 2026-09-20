import type { Database, ImageStore } from './storage'

export interface Env {
  DB: Database
  R2: ImageStore
  ACCESS_TOKEN: string
  RUNTIME?: 'server'
  /** 回收站保留天数（部署级配置）。未设置或 0 表示关闭；Worker 用 vars、服务器用环境变量注入。 */
  TRASH_RETENTION_DAYS?: string
  EDGE_CACHE?: {
    match(request: Request): Promise<Response | undefined>
    put(request: Request, response: Response): Promise<void>
  }
  /** 监控页（Bug 8）用到的 CF 账号级信息。三个查询字段 */
  D1_DATABASE_ID?: string
  R2_BUCKET_NAME?: string
  /** 机密：`wrangler secret put CF_ACCOUNT_ID` / `CF_API_TOKEN` 注入，不进前端 */
  CF_ACCOUNT_ID?: string
  CF_API_TOKEN?: string
  CF_ZONE_ID?: string
}
