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
  star: 0 | 1
  top: 0 | 1
  skin_color: string | null
  invalid: 0 | 1
  create_time: number
  update_time: number
}

/** 笔记正文（note_body 表一行 ↔ NoteBody）。 */
export interface NoteBody {
  note_id: string
  content: string
  version: number
}

/** 分组（note_group 表一行 ↔ Group）。 */
export interface Group {
  group_id: string
  name: string
  ord: number
  color: string | null
  invalid: 0 | 1
  update_time: number
}

/** 客户端从正文派生的三个字段（规格 §6.2）。服务端只存不算。 */
export interface DerivedFields {
  title: string
  summary: string
  thumbnail: string | null
}

/** outbox 任务类型（规格 §8.2）。同一 note_id 的同类任务入队时合并。 */
export type OutboxKind = 'create' | 'body' | 'prop' | 'trash' | 'recover' | 'purge'

/** outbox 任务行（outbox 表一行 ↔ OutboxTask）。 */
export interface OutboxTask {
  id?: number
  note_id: string
  kind: OutboxKind
  payload: unknown
  retry: number
  next_at: number
  /** 修订号：每次入队 +1，push 用它判断「发出去之后这一行有没有被新编辑改过」 */
  seq: number
  /** 1 = 不可重试的失败，移出消费队列等用户处理；新编辑合并进来时归零 */
  failed: 0 | 1
}

/** 本地某条笔记的同步状态（planPull 输入）。 */
export interface LocalNoteState {
  id: string
  /** 服务端已确认的正文版本，用作 PATCH 的 base_version */
  version: number
  /** 本地 body 字段当前对应的服务端版本；0 表示正文还没拉到 */
  body_version: number
  prop_version: number
  /** outbox 里是否有未失败的 body/create 任务——有就别拿远端正文盖本地 */
  body_pending: boolean
}

/** pull 归约结果（planPull 输出）。 */
export interface PullPlan {
  insert: NoteMeta[]
  updateProp: NoteMeta[]
  fetchBody: string[]
}

/** POST /api/notes 请求体（规格 §7.2）。 */
export interface CreateNoteRequest {
  id: string
  create_time: number
  content: string
  title: string
  summary: string
  thumbnail?: string | null
  group_id?: string | null
  star?: 0 | 1
  top?: 0 | 1
  skin_color?: string | null
}

/** POST /api/notes 响应体。 */
export interface CreateNoteResponse {
  id: string
  version: number
  prop_version: number
  update_time: number
}

/** PATCH /api/notes/:id 请求体（规格 §7.2）。 */
export interface PatchNoteRequest {
  content?: string
  title?: string
  summary?: string
  thumbnail?: string | null
  group_id?: string | null
  star?: 0 | 1
  top?: 0 | 1
  skin_color?: string | null
  base_version?: number
  base_prop_version?: number
}

/** PATCH /api/notes/:id 响应体。 */
export interface PatchNoteResponse {
  version: number
  prop_version: number
  update_time: number
  conflicted: boolean
}

/** POST /api/groups 请求体（规格 §7.3）。 */
export interface CreateGroupRequest {
  group_id: string
  name: string
  ord?: number
  color?: string | null
}

/** PATCH /api/groups/:id 请求体。 */
export interface PatchGroupRequest {
  name?: string
  ord?: number
  color?: string | null
}

/** POST /api/sync/pull 请求体（规格 §7.1）。 */
export interface PullRequest {
  since: number
  limit?: number
  cursor?: string | null
}

/** POST /api/sync/pull 响应体。 */
export interface PullResponse {
  notes: NoteMeta[]
  groups: Group[]
  server_time: number
  next_cursor: string | null
}
