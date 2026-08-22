# snotes 设计文档

- 日期：2026-08-22
- 状态：待评审
- 目标：复刻 note.wps.cn（WPS 便签）的核心体验，自用，长期免费运行

---

## 1. 背景与目标

note.wps.cn 即将迁移到功能冗余的新系统。原版有四个不可替代的优点：多端同步迅速、UI 简洁、功能克制、免费。snotes 的目标是保留这四点，并且**数据格式永远不再被锁死**。

设计上的三条硬约束：

1. **免费**：在 Cloudflare 免费额度内长期运行，个人用量不触及任何计费线。
2. **快**：任何编辑操作的界面响应必须与网络无关（本地优先），跨端同步在秒级完成。
3. **不臃肿**：每加一个功能都要能回答「不做会怎样」。答不上来就不做。

### 非目标

- 不做多人协作、分享、评论
- 不做团队/组织/权限
- 不做 AI 摘要、AI 续写
- 不做原版数据迁移导入（从零开始）
- 不做原生 App

---

## 2. 功能范围

### 做

| 功能 | 说明 |
| --- | --- |
| 笔记编辑 | Markdown 所见即所得，标题从正文首行自动提取 |
| 分组 | 单层分组（无嵌套），支持排序与颜色 |
| 搜索 | 纯本地全文搜索，标题 + 正文 |
| 回收站 | 软删除、恢复、清空 |
| 图片插入 | 粘贴/选择上传，存 R2，Markdown `![](url)` 引用 |
| 置顶 / 星标 / 颜色标记 | 三个独立的轻量标记位 |
| 多端同步 | 网页端 + 手机 PWA，增量同步 |

### 明确不做

| 功能 | 砍掉的理由 |
| --- | --- |
| 待办清单 + 定时提醒 | 需要推送通道，PWA 在 iOS 上不可靠；已有专门工具 |
| 语音笔记 | 存储与转写成本高，使用频率低 |
| 富文本样式（字体/字号/颜色） | Markdown 语义化即够用，样式属于渲染层 |
| 笔记内嵌套结构、双链 | 便签不是知识库 |

---

## 3. 原版逆向分析结论

以下结论来自对 note.wps.cn 前端产物与官方 Android APK（`base.apk`，9.6 MB）的静态分析，是本设计的直接依据。

### 3.1 原版技术栈

- Web：Vue 2 + Vuex + Vue Router + Webpack，编辑器为 Quill 2，内容格式为 Quill Delta JSON
- Android：Kotlin + OkHttp + SQLite + MMKV，后台同步由 WorkManager 调度
- 接口基址：`//gonote.wps.cn`，路径前缀 `/gonote/api/v5`
- 鉴权：Cookie `wps_sid` + `withCredentials` + `X-CSRFToken`

### 3.2 原版数据库结构（自 dex 字符串常量池提取）

```sql
t_note_core       (id, title, summary, thumbnails_file_key, version, update_time,
                   user_id, thumb_list, thumb_total, audio_time)   PK(id, user_id)
t_note_property   (id, star, remind_time, remind_cycle, skin_color, user_id,
                   group_id, version, update_time, invalid)        PK(id, user_id)
t_group           (group_id, group_name, group_order, group_invalid,
                   group_update_time, group_user_id, group_upload_status,
                   group_color, group_count)
t_note_sync       (server_note_version, server_info_version,
                   last_fail_time, fail_number, + core 全字段 + property 全字段)
t_note_upload_core (id, user_id, update_index, last_fail_time, fail_number)
t_attachment_upload(path, file_key, user_id, last_fail_time, fail_number)
```

### 3.3 关键发现：「同步快」不靠实时通道

对 Web bundle 与两个 dex 做了穷尽搜索，结论是：

- **没有 WebSocket**（11 处 `WebSocket` 命中全部位于 OkHttp 库代码，非业务调用）
- **没有 SSE、没有长轮询**
- **没有任何推送 SDK**（getui / jpush / umeng / firebase / mipush 命中数均为 0）

原版的「快」来自四个纯数据设计决策，全部可在普通 REST 后端复现：

1. **三段式拆分**（core / property / body），三者版本号独立。改一个星标只上传几十字节，永远不碰正文。
2. **版本清单先行**：`get/noteversion` 先取回全部 `(id, version)` 对，客户端对比后只拉真正变化的正文。
3. **上传队列 + 指数退避**：`fail_number` / `last_fail_time` 字段说明失败重试是持久化的，离线容忍。
4. **WorkManager 系统级调度**：切前台、联网、周期性三类触发。

**这条结论决定了整个方案：snotes 不需要任何实时基础设施。**

### 3.4 原版接口清单（节选，作为功能对照）

```
notesvr/get/notegroup        notesvr/set/notegroup       notesvr/delete/notegroup
notesvr/web/getnotes/group   notesvr/get/noteinfo        notesvr/v2/getnotebody
notesvr/set/noteinfo         notesvr/set/notecontent     notesvr/delete
notesvr/cleanrecyclebin      notesvr/recover/notes
s3/requestupload             s3/requestdownload          s3/mappingfilekey
v5/notesvr/get/noteversion   v5/notesvr/get/notesummary  v5/notesvr/get/notenum
```

---

## 4. 技术选型

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 前端框架 | Vue 3 + Vite | 与原版同源心智，生态成熟，构建快 |
| 状态管理 | Pinia | Vue 3 官方推荐，比 Vuex 轻 |
| 编辑器 | Milkdown（ProseMirror + remark） | 所见即所得，UI 完全可控，按需引入体积可控 |
| 本地存储 | IndexedDB via Dexie | 本地优先的基础设施，支持大容量与索引 |
| 后端运行时 | Cloudflare Workers | 免费额度充足，全球边缘，零运维 |
| 后端框架 | Hono | 为 Workers 设计，体积小，路由与中间件够用 |
| 数据库 | Cloudflare D1（SQLite） | 与 Workers 同生态，免费额度覆盖个人用量 |
| 对象存储 | Cloudflare R2 | 出网流量免费，避免图床带宽账单 |
| 静态托管 | Workers 静态资源 + SPA fallback | 与 API 同一个 Worker，同域，无跨域 |
| 移动端形态 | PWA（manifest + Workbox） | 一套代码双端，无需应用商店 |

### 4.1 内容格式：Markdown（而非 Quill Delta）

原版用 Quill Delta。snotes 改用 Markdown，原因：

- 采用 Delta 的唯一理由是与原版格式兼容，而本项目从零开始，该理由不成立
- Markdown 是纯字符串：存储字段简化、摘要提取用 `slice`、本地搜索直接 `includes`、缩略图提取用一条正则、体积比等价 Delta JSON 小一个量级
- **战略价值**：正在经历的迁移之痛，本质是数据被锁在私有格式里。Markdown 让这件事不会再发生第二次。

代价只有一处：所见即所得编辑器的选型与调试成本。这是本项目唯一真实的技术风险，见 §15。

### 4.2 编辑器：Milkdown，备选 Vditor

选 Milkdown 是因为 UI 完全由自己控制（用户核心诉求是「简洁」，Vditor 自带的工具栏与皮肤反而要花力气拆掉），且基于 ProseMirror，移动端选区与滚动表现更成熟。

**已知风险**：ProseMirror 在 iOS Safari 上的中文输入法 composition 事件历史上有过问题。实施阶段第一个里程碑内必须在真机上实测中文连续输入、光标定位、退格；若不达标，降级顺序为 Vditor IR 模式 → CodeMirror 源码模式 + 分屏预览。

---

## 5. 系统架构

```
┌────────────────────┐         ┌────────────────────┐
│  桌面浏览器         │         │  手机 PWA           │
│  Vue 3 SPA         │         │  同一份 Vue 3 SPA   │
│  ├ Milkdown 编辑器 │         │                    │
│  ├ Pinia 状态      │         │                    │
│  ├ Dexie 本地库 ◄──┼── 所有读写先落本地 ──┼──► Dexie 本地库    │
│  └ 同步引擎        │         │  └ 同步引擎        │
└─────────┬──────────┘         └─────────┬──────────┘
          │  HTTPS + Bearer Token        │
          └──────────────┬───────────────┘
                         ▼
          ┌──────────────────────────────┐
          │  Cloudflare Worker (Hono)    │
          │  ├ 静态资源 + SPA fallback   │
          │  ├ /api/sync/*               │
          │  ├ /api/notes/*  /groups/*   │
          │  └ /api/images/*             │
          └───────┬──────────────┬───────┘
                  ▼              ▼
              ┌───────┐     ┌────────┐
              │  D1   │     │   R2   │
              │ 元数据 │     │  图片   │
              │ + 正文 │     │        │
              └───────┘     └────────┘
```

### 5.1 本地优先（local-first）原则

这是「快」的唯一来源，不可妥协：

- **所有读操作只读 IndexedDB**，永不等待网络
- **所有写操作先写 IndexedDB**，立即返回，界面立刻更新
- 写入同时向上传队列追加一条任务，同步引擎在后台异步处理
- 网络失败不影响任何界面行为，只让队列积压

结果：断网可用，弱网无感，Cloudflare 在国内偶发的不稳定不会转化为体感卡顿。

---

## 6. 数据模型

### 6.1 D1 表结构

```sql
CREATE TABLE note (
  id            TEXT PRIMARY KEY,       -- 客户端生成的 UUID v4
  group_id      TEXT,                   -- NULL 表示未分组
  title         TEXT NOT NULL DEFAULT '',
  summary       TEXT NOT NULL DEFAULT '',
  thumbnail     TEXT,                   -- 正文首图 file_key，列表缩略图用
  version       INTEGER NOT NULL DEFAULT 1,  -- 正文版本（含 title/summary/thumbnail）
  prop_version  INTEGER NOT NULL DEFAULT 1,  -- 属性版本（分组/星标/置顶/颜色/删除态）
  star          INTEGER NOT NULL DEFAULT 0,
  top           INTEGER NOT NULL DEFAULT 0,
  skin_color    TEXT,
  invalid       INTEGER NOT NULL DEFAULT 0,  -- 0 正常 1 回收站
  create_time   INTEGER NOT NULL,
  update_time   INTEGER NOT NULL             -- 服务端时钟，毫秒
);
CREATE INDEX idx_note_update ON note(update_time);

CREATE TABLE note_body (
  note_id  TEXT PRIMARY KEY REFERENCES note(id) ON DELETE CASCADE,
  content  TEXT NOT NULL DEFAULT '',      -- Markdown 原文
  version  INTEGER NOT NULL DEFAULT 1     -- 与 note.version 同步递增
);

CREATE TABLE note_group (
  group_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  ord          INTEGER NOT NULL DEFAULT 0,
  color        TEXT,
  invalid      INTEGER NOT NULL DEFAULT 0,
  update_time  INTEGER NOT NULL
);
CREATE INDEX idx_group_update ON note_group(update_time);

CREATE TABLE image (
  file_key     TEXT PRIMARY KEY,          -- R2 object key
  note_id      TEXT NOT NULL,
  size         INTEGER NOT NULL,
  mime         TEXT NOT NULL,
  create_time  INTEGER NOT NULL
);
CREATE INDEX idx_image_note ON image(note_id);
```

#### 相对原版的三处修正

1. **正文独立成 `note_body` 表**：原版把正文放在 core 表里，导致列表查询必然扫过大字段。snotes 拆开后，列表查询 `SELECT ... FROM note` 永远不触碰正文。
2. **元数据与属性合并回一张 `note` 表，但保留两个版本号**：拆表在服务端带来的收益接近零（都在同一次查询里），却引入了 `invalid` 在两张表上语义重复的歧义。合表消歧义，双版本号保留「改星标不重传正文」的核心收益。
3. **`top`（置顶）独立成字段**，不复用 `star`。原版没有置顶，这是本项目新增功能。

### 6.2 版本号语义

| 版本号 | 覆盖字段 | 递增时机 |
| --- | --- | --- |
| `version` | `content`、`title`、`summary`、`thumbnail` | 正文变更 |
| `prop_version` | `group_id`、`star`、`top`、`skin_color`、`invalid` | 属性变更 |

标题不是独立输入框，而是**从 Markdown 正文首行自动提取**（去掉前导 `#` 与空白，截断 64 字符）。摘要取正文前 120 字符的纯文本。缩略图取正文中第一个 `![](...)` 的 file_key。因此 title / summary / thumbnail 三者均归属正文版本。

**这三个派生字段由客户端计算，随 `content` 一起提交，服务端只存不算。** 理由：本地优先架构下客户端必须能在离线时立即算出标题来渲染列表，服务端再实现一遍等价逻辑只会产生两份会漂移的实现。单用户场景不存在伪造动机。

`create_time` 由客户端在创建时生成（离线创建也必须立刻拥有），`update_time` 一律由服务端时钟写入（同步游标依赖它单调可比，见 §8.1）。

### 6.3 IndexedDB（Dexie）结构

```
notes        主键 id，索引 update_time / group_id / invalid / star / top
             字段与 D1 的 note 表一致，另加：
               body          本地正文（Markdown 字符串）
               body_version  本地正文版本
               dirty         'none' | 'body' | 'prop' | 'both'
outbox       自增主键，{ note_id, kind, payload, retry, next_at }
groups       主键 group_id
meta         { key: 'sync_cursor', value: <server_time> } 等单例配置
```

客户端与服务端字段刻意保持同名同义，避免映射层。

---

## 7. API 设计

统一前缀 `/api`，请求与响应均为 JSON，鉴权见 §11。

### 7.1 同步

```
POST /api/sync/pull
  请求  { since: number, limit?: number, cursor?: string }
  响应  {
          notes:  [{ id, group_id, title, summary, thumbnail,
                     version, prop_version, star, top, skin_color,
                     invalid, create_time, update_time }],
          groups: [{ group_id, name, ord, color, invalid, update_time }],
          server_time: number,      -- 下次 pull 的 since
          next_cursor: string|null  -- 非 null 表示还有下一页
        }
```

- `since = 0` 表示全量冷启动
- 服务端条件为 `update_time >= since`（用 `>=` 而非 `>`，防止同毫秒写入被跳过；重复数据由客户端按 `version` 幂等去重）
- `limit` 默认 200，最大 500
- **`cursor` 只作用于 `notes`**，值为上一页最后一条的 `(update_time, id)` 编码。`groups` 只在第一页（`cursor` 为空时）全量返回，后续页 `groups` 恒为空数组——个人分组数量在几十条量级，分页毫无意义。
- **响应不含正文**。客户端对比 `version` 后，只对真正变化的笔记调用下面的接口拉正文。

```
POST /api/sync/bodies
  请求  { ids: string[] }        -- 单次上限 50
  响应  { bodies: [{ note_id, content, version }] }
```

删除采用软删除，`invalid=1` 的记录照常出现在 `pull` 结果里，因此不需要独立的 tombstone 通道。物理删除只在清空回收站时发生，届时返回 `purged: string[]` 让客户端清理本地。

### 7.2 笔记

```
POST   /api/notes                 { id, create_time, content, title, summary,
                                    thumbnail?, group_id?, star?, top?, skin_color? }
                                  → { id, version, prop_version, update_time }
PATCH  /api/notes/:id             { content?, title?, summary?, thumbnail?,
                                    group_id?, star?, top?, skin_color?,
                                    base_version?, base_prop_version? }
                                  → { version, prop_version, update_time, conflicted }
POST   /api/notes/:id/trash       → { prop_version, update_time }
POST   /api/notes/:id/recover     → { prop_version, update_time }
POST   /api/notes/:id/purge       → { ok: true }
POST   /api/trash/clean           → { purged: string[] }
```

- `id` 由客户端生成（UUID v4），保证离线创建也能立刻拥有稳定标识，且重放安全
- `PATCH` 只提交变化的字段；含 `content` 则 `version+1`，含任一属性字段则 `prop_version+1`
- 提交 `content` 时**必须同时提交 `title`、`summary`、`thumbnail` 与 `base_version`**（三个派生字段的计算方在客户端，见 §6.2）；只改属性时必须带 `base_prop_version`
- `base_version` / `base_prop_version` 用于冲突检测：若服务端当前版本高于它，仍按最后写入者胜（LWW）接受，但响应 `conflicted: true`，客户端据此生成冲突副本（见 §8.5）

### 7.3 分组

```
POST   /api/groups        { group_id, name, ord?, color? } → { update_time }
PATCH  /api/groups/:id    { name?, ord?, color? }          → { update_time }
DELETE /api/groups/:id                                     → { update_time }
```

删除分组为软删除；组内笔记的 `group_id` 置 NULL（回到未分组），不级联删除笔记。

### 7.4 图片

```
POST /api/images/upload    multipart/form-data: file, note_id
                           → { file_key, url, size, mime }
GET  /api/images/:file_key → 图片二进制（带 Cache-Control 与 ETag）
```

见 §9。

---

## 8. 同步机制

### 8.1 拉取（pull）

```
1. 读本地 meta.sync_cursor（首次为 0）
2. POST /api/sync/pull { since: cursor }
3. 逐页处理，直到 next_cursor 为 null
4. 对每条返回的 note：
     本地不存在                  → 插入（正文标记为待拉取）
     远端 prop_version > 本地    → 更新属性字段
     远端 version > 本地         → 记入待拉正文列表
     两者都不大于本地            → 忽略（幂等）
5. 待拉正文列表按 50 条一批调用 /api/sync/bodies
6. 所有分页与所有正文批次全部成功后，才写入
   meta.sync_cursor = 第一页响应里的 server_time
   任一步失败则整轮不推进游标，下次整轮重来
   （幂等：重复数据被步骤 4 的版本对比忽略）
```

游标必须取**服务端返回的 `server_time`**，绝不用客户端本地时钟——手机时钟漂移会造成永久性漏同步。

### 8.2 推送（push）

- 任何本地写操作都往 `outbox` 追加任务，并把 `notes.dirty` 置位
- **同一 `note_id` 的同类任务在入队时合并**：只保留最新 payload。连续敲字不会产生上百个请求。
- 编辑器停止输入 **800 ms** 后触发一次落库 + 入队（debounce）
- 同步引擎串行消费 outbox，成功则删除任务并清 `dirty`

### 8.3 触发时机

| 触发点 | 说明 |
| --- | --- |
| 应用启动 | 立即 pull |
| 页面重新可见 | `visibilitychange` → visible 时 pull（对应原版切前台） |
| 网络恢复 | `online` 事件 → 先 push 再 pull |
| 定时 | 前台每 30 秒一次轻量 pull |
| 本地写入后 | debounce 800 ms 后 push |

前台 30 秒轮询是「秒级同步」体感的来源。一天按 4 小时活跃计算是 480 次请求，远低于免费额度。

### 8.4 失败与退避

- 每条 outbox 任务带 `retry` 与 `next_at`
- 退避序列：1s → 2s → 4s → 8s → … → 封顶 600s
- HTTP 4xx（除 408/429）视为不可重试，任务移入本地失败列表并提示用户，不无限重试
- 5xx / 网络错误按退避重试

### 8.5 冲突

个人单用户场景冲突极少（只发生在两端同时离线编辑同一条）。策略为**最后写入者胜**，但不静默：服务端返回 `conflicted: true` 时，客户端把被覆盖的本地版本另存为一条新笔记（标题加 `（冲突副本）`），并提示。宁可多一条笔记，不可丢一段文字。

---

## 9. 图片

### 9.1 上传流程

```
用户粘贴/选择图片
  → 前端压缩（长边 ≤ 1600px，JPEG quality 0.82，PNG 保留透明）
  → POST /api/images/upload（multipart）
  → Worker 校验 token、大小、MIME
  → 写入 R2，key = <note_id>/<uuid>.<ext>
  → 写入 D1 image 表
  → 返回 { file_key, url }
  → 编辑器插入 ![](/api/images/<file_key>)
```

上传中先用本地 `blob:` URL 占位，成功后替换为正式 URL，失败则保留占位并提示重试。

### 9.2 为什么走 Worker 而不是直传 R2

早期方案是客户端直传 R2。该方案有两个致命问题：

1. 直传需要 R2 bucket **公开可读**，任何人拿到 URL 就能看笔记里的图片——对私人笔记不可接受
2. 需要在前端手写 S3 V4 预签名，复杂且易错

Workers 免费版单次请求体上限为 **100 MB**，而压缩后的图片是 200 KB ~ 2 MB 量级，「必须绕过 Worker」的前提不成立。因此改为**全部经 Worker 中转 + R2 binding**：桶保持私有，鉴权与后端一致，代码更短。

### 9.3 读取与缓存

- `GET /api/images/:file_key` 从 R2 读出，设置 `Cache-Control: public, max-age=31536000, immutable`（key 含 UUID，内容不可变）
- Worker 内用 Cache API 做边缘缓存，第二次起不再回源 R2，节省 Class B 操作
- Service Worker 侧对该路径使用 CacheFirst 策略，离线可看图

### 9.4 孤儿图片回收

删除笔记时不立即删图（可能还在回收站）。清空回收站时，按 `image.note_id` 批量删除 R2 对象与 D1 记录。这是唯一的清理时机，逻辑简单且不需要定时任务。

---

## 10. 搜索

**纯本地实现，零后端成本。**

- 数据全量常驻 IndexedDB，搜索直接在内存中对 `title + body` 做大小写不敏感的子串匹配
- 输入 debounce 150 ms
- 个人笔记规模（数千条、数 MB 文本）下，朴素遍历在毫秒级完成，不需要倒排索引
- 结果按「标题命中优先 → 更新时间倒序」排序，命中片段高亮

不做服务端搜索的理由：任何服务端方案（D1 FTS5、外部搜索服务）都会增加请求量与复杂度，而本地方案更快且离线可用。

---

## 11. 鉴权与安全

### 11.1 一次性令牌

- 部署时通过 `wrangler secret put ACCESS_TOKEN` 设置一个长随机串（≥ 32 字节，base64url）
- 首次打开网页时输入一次，存入 `localStorage`
- 之后所有 API 请求带 `Authorization: Bearer <token>`
- Worker 中间件用**常量时间比较**校验，失败返回 401
- 前端收到 401 时清空本地 token 并回到输入页

选择理由：单用户自用，OAuth / 邮箱验证码 / 密码哈希都是纯粹的复杂度。令牌泄露的补救是改一次 secret 重新部署，成本可接受。

### 11.2 安全边界

| 项 | 措施 |
| --- | --- |
| 传输 | 全站 HTTPS（Cloudflare 强制） |
| R2 桶 | 保持私有，不开公开访问，只经 Worker 读写 |
| 上传校验 | MIME 白名单（jpeg/png/gif/webp），单文件 ≤ 10 MB |
| XSS | Markdown 渲染时禁用原始 HTML；图片 URL 只允许同源 `/api/images/` |
| 令牌存储 | localStorage；不写入任何日志，不进 URL query |
| 仓库卫生 | `.dev.vars` 与 `.env` 加入 `.gitignore`，密钥永不入库 |

---

## 12. PWA

- `manifest.webmanifest`：`display: standalone`、图标、主题色、`start_url: /`
- Workbox 生成 Service Worker：
  - app shell（HTML/JS/CSS）预缓存，StaleWhileRevalidate
  - `/api/images/*` CacheFirst
  - **`/api/` 其余路径一律 NetworkOnly**——数据的离线能力由 IndexedDB 提供，不由 SW 缓存提供，两者混用会造成难以排查的陈旧数据
- 手机端通过「添加到主屏幕」安装，全屏无地址栏

**iOS 注意**：iOS Safari 会在存储压力下清理 IndexedDB。缓解措施：应用启动时调用 `navigator.storage.persist()` 申请持久化权限；同步引擎保证服务端始终是完整副本，本地被清理时冷启动可完整恢复。

---

## 13. 部署与运维

### 13.1 项目结构

```
snotes/
├─ src/                  前端 Vue 3
│  ├─ components/
│  ├─ stores/            Pinia
│  ├─ db/                Dexie 定义与访问层
│  ├─ sync/              同步引擎（pull / push / outbox / backoff）
│  ├─ editor/            Milkdown 封装
│  └─ main.ts
├─ worker/               后端
│  ├─ index.ts           Hono 应用入口
│  ├─ routes/            notes / groups / sync / images
│  ├─ auth.ts
│  └─ db.ts              D1 访问层
├─ migrations/           D1 SQL 迁移
├─ docs/superpowers/specs/
├─ wrangler.toml
└─ package.json
```

### 13.2 部署

- 单个 Worker 同时提供静态资源与 API，同域，无 CORS
- `wrangler.toml` 配置 `assets`（含 SPA fallback）、`d1_databases`、`r2_buckets` 绑定
- schema 变更通过 `wrangler d1 migrations apply` 管理，不手工改库
- 部署命令：`npm run build && wrangler deploy`

### 13.3 备份

每月手动执行一次 `wrangler d1 export` 导出 SQL 文件留存。图片在 R2 中已有冗余，不单独备份。个人项目不需要自动化备份流水线。

---

## 14. 免费额度核算

以下为 Cloudflare 官方文档核实的数字（2026-08-22）：

| 资源 | 免费额度（已核实） | 预估用量 |
| --- | --- | --- |
| D1 存储 | 5 GB 总量 | 数千条笔记 < 50 MB |
| R2 存储 | 10 GB-月 / 月 | 图片 < 1 GB |
| R2 出网流量 | 免费（所有存储类别） | 不计 |
| Workers 请求体 | 单次 100 MB（Free） | 单图 < 10 MB |

以下数字因官方页面为 JS 动态渲染未能直接抓取，为公开资料中的常见值，**属于约数**：D1 每日读约 500 万行 / 写约 10 万行，R2 每月 Class A 约 100 万次 / Class B 约 1000 万次，Workers 每日 10 万次请求。

按最激进的估算（每天 480 次前台轮询 + 200 次编辑推送 ≈ 700 次请求/天），距 10 万次/天的线仍有两个数量级余量。**个人自用触及计费线的概率可忽略。**

---

## 15. 风险与权衡

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Milkdown 在 iOS 中文输入法下体验不佳 | 直接影响每天的手感 | 第一个里程碑内真机实测；不达标按 Vditor IR → CodeMirror 源码模式降级 |
| Cloudflare 在中国大陆访问偶发不稳定 | 同步延迟 | 本地优先架构使网络质量不影响任何界面响应；同步失败只是队列积压 |
| iOS PWA 的 IndexedDB 被系统清理 | 本地数据丢失 | `storage.persist()` + 服务端完整副本，冷启动可完整恢复 |
| 单令牌泄露 | 全部笔记暴露 | 更换 secret 重新部署；令牌不入日志不入 URL |
| 前台 30 秒轮询在极端场景放大请求 | 额度消耗 | 页面不可见时停止轮询；无变更时响应体极小 |

### 已明确接受的权衡

- **不做实时协作**：换来架构简单与零成本，且逆向证明原版也没有
- **不做服务端搜索**：换来更快的响应与离线可用
- **单用户单令牌**：换来零鉴权复杂度
- **软删除只在清空回收站时物理清理**：换来同步逻辑不需要独立的墓碑通道

---

## 16. 测试策略

| 层次 | 工具 | 覆盖内容 |
| --- | --- | --- |
| 单元 | Vitest | 标题提取、摘要生成、缩略图正则、退避计算、outbox 合并、版本对比与幂等判定 |
| 后端集成 | Vitest + `@cloudflare/vitest-pool-workers` | 各路由的鉴权、参数校验、版本递增、分页游标、冲突标记 |
| 同步引擎 | Vitest（模拟网络） | 离线写入→恢复后推送、重复 pull 幂等、冲突副本生成、失败退避 |
| 端到端 | Playwright | 新建→编辑→插图→分组→搜索→删除→恢复的完整链路 |

同步引擎是本项目 bug 密度最高的部分，必须有独立且充分的测试。

---

## 附录 A：术语

| 术语 | 含义 |
| --- | --- |
| outbox | 本地待上传队列 |
| cursor / since | 增量同步的时间游标，取服务端时钟 |
| file_key | R2 中的对象键，同时是图片主键 |
| invalid | 软删除标记，1 表示在回收站 |
| LWW | Last-Write-Wins，最后写入者胜 |
