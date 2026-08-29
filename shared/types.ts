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
  /** 0=正常，1=回收站（可恢复），2=墓碑（已被物理删除，客户端据此删本地副本） */
  invalid: 0 | 1 | 2
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
  /** 远端已物理删除（invalid=2 墓碑），本地需删掉对应副本 */
  deleteLocal: NoteMeta[]
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

/** POST /api/sync/bodies 请求体（规格 §7.1）。 */
export interface BodiesRequest {
  ids: string[]
}

/** POST /api/sync/bodies 响应体。 */
export interface BodiesResponse {
  bodies: NoteBody[]
}

/** POST /api/notes/opens：本设备累计打开数上报与其它设备聚合拉取。 */
export interface OpensSyncRequest {
  device_id: string
  since: number
  items: { note_id: string; count: number; last_open_time: number }[]
}

export interface OpenAggregate {
  note_id: string
  others_count: number
  others_last_open_time: number
}

export interface OpensSyncResponse {
  opens: OpenAggregate[]
  server_time: number
}

/** 本地某条笔记的 dirty 标记（哪些轨道有未推送的改动）。 */
export type DirtyState = 'none' | 'body' | 'prop' | 'both'

/** 本地笔记（LocalNote = NoteMeta + 正文 + 正文版本 + dirty）。
 *
 * open_count / last_open_time 是本设备累计值；其它设备的聚合值存为本地派生字段。
 * 所有这些字段都不进入笔记内容 outbox，也不改变 update_time。 */
export interface LocalNote extends NoteMeta {
  body: string
  body_version: number
  dirty: DirtyState
  /** 本设备打开次数。旧笔记可能缺失，按 0 兜底。 */
  open_count?: number
  /** 本设备最近一次打开时间戳。 */
  last_open_time?: number
  /** 服务端聚合的其它设备打开次数。 */
  open_others?: number
  /** 服务端聚合的其它设备最近打开时间。 */
  open_others_time?: number
}

/* === 监控页（Bug 8）D1/R2/HITP 指标 === */

/** 近 N 天趋势里的一个点。除 date 外，各指标按需填自己的聚合字段。 */
export interface MetricsTrendPoint {
  date: string
  [key: string]: string | number
}

/** D1：读/写行数、SQL 次数、平均耗时（近 7 天按天聚合） */
export interface D1Usage {
  readsToday: number
  writesToday: number
  sqlToday: number
  avgMs: number
  trend: MetricsTrendPoint[]
}

/** R2：存储量/对象数（最新快照）+ Class A / Class B 操作数 */
export interface R2Usage {
  objects: number
  bytes: number
  classAToday: number
  classBToday: number
  trend: MetricsTrendPoint[]
}

/** 账号级 Workers Invocations，用于对照免费版请求额度。 */
export interface WorkersUsage {
  requestsToday: number
  trend: MetricsTrendPoint[]
}

export type QuotaStatus = 'safe' | 'warning' | 'over' | 'unavailable'

/** 单个免费额度项。used 的口径由 cycle 决定：daily=单日峰值，monthly=当月累计。 */
export interface QuotaItem {
  label: string
  /** daily / monthly / snapshot，分别表示按日额度、自然月额度和当前存储快照 */
  cycle: 'daily' | 'monthly' | 'snapshot'
  /** 判定用量：daily 取本月单日最高，monthly 取当月累计，snapshot 取最新值 */
  used: number
  /** 免费额度上限 */
  limit: number
  /** 已用百分比，不封顶，便于看到超过 100% 的幅度 */
  percent: number
  status: QuotaStatus
  /** 辅助读数：daily 显示今日，monthly 显示今日，snapshot 显示对象数 */
  secondaryLabel?: string
  secondaryValue?: number
  /** 本月单日最高发生日期；仅 daily 提供 */
  peakDate?: string
  /** 面向用户的判定说明 */
  explanation: string
  /** 数据不可用或查询失败时为 false */
  available: boolean
  /** 单位标签，如 行、次、GB、请求 */
  unit: '行' | '次' | 'GB' | '请求'
}

export interface Quota {
  /** 当月已过天数（含今天），用于换算日均进度 */
  monthDays: number
  /** safe / warning / over / unavailable，代表整页最严重状态 */
  status: QuotaStatus
  overCount: number
  warningCount: number
  items: QuotaItem[]
}

export interface MetricsData {
  d1: D1Usage | null
  r2: R2Usage | null
  workers: WorkersUsage | null
  /** 当月用量 vs 免费额度；即使个别指标查不到也给出已知项 */
  quota: Quota
}


