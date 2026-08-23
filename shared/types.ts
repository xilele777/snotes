// shared/types.ts —— 前后端共用的类型定义（规格 §6.1 / §6.2）
// 零依赖、零 IO，可同时被前端 (tsconfig.app) 与 Worker (tsconfig.worker) 引用。

/** 笔记元数据（note 表一行 ↔ NoteMeta）。 */
export interface NoteMeta {
  id: string
  group_id: string | null
  title: string
  summary: string
  thumbnail: string | null
  version: number
  prop_version: number
  star: number
  top: number
  skin_color: string | null
  invalid: number
  create_time: number
  update_time: number
}

/** 分组（note_group 表一行 ↔ Group）。 */
export interface Group {
  group_id: string
  name: string
  ord: number
  color: string | null
  invalid: number
  update_time: number
}

/** 客户端从正文派生的三个字段（规格 §6.2）。服务端只存不算。 */
export interface DerivedFields {
  title: string
  summary: string
  thumbnail: string | null
}
