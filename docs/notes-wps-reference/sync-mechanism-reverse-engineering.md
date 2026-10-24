# WPS 便签同步机制逆向报告

- 调研日期：2026-10-24。
- 状态：调研完成；本报告记录调研阶段事实，仅供学习同步架构设计，不构成对 WPS 服务的调用指南。
- 方法：对 `note.wps.cn` 线上前端 JavaScript bundle 的静态分析（未登录、未抓取任何带凭据的请求），配合公开资料检索。
- 样本：2026-10-24 线上构建 `index.37c12598.js`（555 KB）、`chunk-common.630d20c7.js`（92 KB）、`chunk-vendors.58a56488.js`（4.2 MB）及 8 个懒加载 chunk。本目录中 2026-08-23 的 `index.js` / `chunk-common.js` 为旧版构建（模块 id 与线上版一致），已抽查确认加密常量、同步队列、双版本号、S3 凭证接口等关键机制两版均在，结论跨版本稳定。
- 范围边界：只做了只读页面请求与已发布前端代码分析；未调用任何写接口验证，未抓取登录态流量，不保留 Cookie 与账号凭据。本文引用的密钥常量均为公开发布 bundle 中的产品常量，非用户凭据。

## 0. 证据等级

| 标记 | 含义 |
| --- | --- |
| B：代码核验 | 线上 bundle 中找到明确定义或调用（本次未执行对应写操作） |
| C：推断 | 根据前端结构与公开资料推断，不能当作服务端实现事实 |

本次没有 A 级（运行核验）证据：未在登录态下观察真实请求时序。所有接口行为描述均来自前端调用代码，服务端校验逻辑（版本冲突如何判定、返回码含义）属 C 级推断。

## 1. 结论速览

WPS 便签 Web 端**没有 WebSocket，也没有轮询**（bundle 全文搜索无 socket.io / SockJS / signalr / 长轮询，index 包无 `setInterval`）。它的「秒同步、无感知」来自**本地优先 + 同步队列 + 乐观并发控制**：

1. 编辑先落本地内存，UI 即时生效，网络是后台补偿；
2. 500ms 防抖后入同步队列，按 noteId 合并（coalescing）后串行上传；
3. 请求带 `localContentVersion` / `localInfoVersion` 做乐观并发控制，成功后服务器权威回填新版本号；
4. 读取侧全部「按需拉取 + 版本比对」，无推送、无定时器；
5. 两个超预期发现：**全链路客户端 AES 加密**（标题/摘要/正文上传前均为密文）与**浏览器直传 AWS S3 中国区**（STS 凭证同样密文下发）。

## 2. 技术栈与通信方式

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 框架 | Vue 2 + Vuex + Element UI + Quill 编辑器，webpack 分包 + SRI 校验 | B |
| 通信 | 纯 REST（axios，`withCredentials: true`） | B |
| 实时通道 | 无（Web 端） | B（否定性结论，来自全文关键词搜索） |
| HTML 壳 | 6.4 KB SPA 加载壳，`<div id=route>` 挂载 | B |

跨端说明：移动/桌面客户端（包名 `cn.wps.note`）共用同一套 `notesvr` REST 协议（C：公开导出脚本实践佐证），其本机推送通道不在本次样本范围内，无法核验。

## 3. 服务域名分工与鉴权

模块 `5a50` 中定义的基址（B）：

| 域名 | 职责 |
| --- | --- |
| `note-api.wps.cn` | 便签主 API（所有 `/notesvr/*`、`/s3/*`） |
| `drive.wps.cn` | WPS 云文档（KDrive），每条便签对应一个 `.wpsnote` 文件 |
| `account.wps.cn` | 账号/登录态（`/api/v3/islogin`）、协议查询 |
| `{bucket}.s3.{region}.amazonaws.com.cn` | S3 中国区直传：大正文、图片、缩略图 |

鉴权（B）：WPS 通行证 Cookie，无请求签名。部分 GET 带 `X-user-key: {uid}` 头；响应 `errorCode === -1011`（模块 `5a50` 导出常量）表示会话失效，axios 拦截器（模块 `dbc6`）触发全局 `USER_CHANGE` 事件，页面 `location.reload()`。另有 `X-CSRFToken`（account 域协议接口）、`X-Model`（迁移接口）两个零散头。

## 4. 数据模型与双版本号

建笔记 action 中的初始对象（B）给出完整字段：

```js
{
  noteId, groupId, title, summary, body, bodyType,   // bodyType: 0=内联密文, 1=S3 文件
  thumbnail, star, remindTime, remindType,
  infoVersion,        // 元数据版本（星标/提醒/分组/置顶）
  contentVersion,     // 正文版本
  infoUpdateTime, contentUpdateTime, createTime,
  belongTo, drive_gid, fileid, isNewNote
}
```

关键设计（B）：**info 与 content 的版本号、更新时间完全分离**。加星、改提醒只走 `set/noteinfo` 小包，不触碰正文大包；两路并发互不阻塞。列表排序用 `contentUpdateTime`，列表拉取用 `startIndex/rows` 分页（rows=50）。

## 5. 加密体系（抓包看不到明文的原因）

webpack 模块 `4eb3` 完整解出（B）：

```js
// CryptoJS AES-CBC + PKCS7
IV 固定硬编码: "5150956153345366"         // 16 字节 UTF-8
主密钥硬编码: "H9n&S@oGohGpV6d7*"         // 仅用于解出用户密钥

init(encryptedString):
    用户密钥 K = AES_decrypt(encryptedString, key = MD5(主密钥), IV)

encrypt(text):  AES_encrypt(text, key = MD5(K), IV)   // 实际为 AES-128
```

- 用户密钥 `K` 来自 `POST /notesvr/get/web-config` 响应的 `data.aesPassword` 字段（本身是主密钥加密的密文），页面加载时 `initEncryptor()` 解出（B）。
- 上传时的字段打包方式（B，`updateContent` action）：

  ```js
  a.title   = encrypt("")                      // title 字段是空占位
  a.summary = encrypt(title + "\n" + summary)  // 真正的标题+摘要打包进 summary
  a.body    = encrypt(body)                    // 正文密文
  ```

- 下载侧统一 `decrypt(title) + decrypt(summary)` 后按 `\n` 拆分（mutation 侧 `Pt()` 函数，B）。
- 正文 ≥ 10240 字符或 `bodyType === 1`：明文字节加密后直传 S3（key 为 `{noteId}.encrypted`），API 的 `body` 字段只存加密后的引用（B）。

安全性评价（C）：这不是端到端加密——密钥经同一会话由服务端下发，服务器理论上可解。其作用是传输层以下全密文：抓包、代理日志、S3 存储桶、CDN 缓存中均无明文。固定 IV 全局共享、密钥通道与会话同源，属弱设计，自研系统应引以为戒。

## 6. 写路径：上传为何「无感」

完整管线（B）：

```
Quill textChange
  → debounce 500ms（handleQuillEditorTextChanged）
  → 从 delta 提取 title/summary/body/首图缩略图
  → commit 到 Vuex（UI 立即更新，不等网络）
  → addSyncQueue({noteId, ...})
  → startSyncQueue(0)：串行上传
  → updateContent：[新笔记先在 KDrive 建文件] → set/noteinfo → set/notecontent
  → 服务器返回新 contentVersion/infoVersion → 回填本地
```

三个核心机制（B）：

**① 队列按笔记合并**（mutation `ADD_SYNC_QUEUE`）：同 `noteId` 的 pending 条目以 `{...旧字段, ...新字段}` 合并替换，连续打字只产生一条待传记录；正在上传（synchronizing）中的条目不合并、允许再次入队，保证最后一次编辑一定被上传。实现 outbox 时漏掉这一条会丢末次编辑。

**② 串行处理 + 跳过式容错**（action `startSyncQueue`）：一次只传一条；成功则出队并处理下一条；失败标记 `fail`、错误记入 `syncQueueErrors[noteId]`，直接 `startSyncQueue(++i)` 跳到下一条，不阻塞队列。UI 层：列表顶部「同步失败」横幅 + 重试按钮；移动端弹 `note_conflict_dialog` 冲突框。

**③ 乐观并发控制**：请求带 `localContentVersion` / `localInfoVersion`，服务器校验通过才落库，成功后由服务器权威下发新版本号与时间戳，客户端只存不做本地合并（冲突判定与拒绝行为是服务端的，属 C 级推断）。

上传接口请求体（B）：

```jsonc
POST https://note-api.wps.cn/notesvr/set/notecontent
{ "title": "<AES密文>", "summary": "<AES密文>", "body": "<AES密文>",
  "bodyType": 0, "localContentVersion": 3 }

POST /notesvr/set/noteinfo
{ "noteId": "...", "localInfoVersion": 2, "star": 1,
  "remindTime": 0, "remindType": 0, "groupId": "..." }
```

兜底（B）：`beforeunload` 时队列非 idle 则弹「还有未保存的便签」；缺标题的纯图片/录音笔记入队时自动补 `[图片]` / `[录音文件]` 占位标题。

## 7. 读路径：拉取为何「无感」

Web 端无推送，靠四类交互点位按需拉取（B）：

| 触发点 | 行为 |
| --- | --- |
| 冷启动 | 登录态 → web-config（密钥）→ 分组列表 → home 列表分页 50 条 |
| 切换视图 | 分组 `POST /notesvr/web/getnotes/group`；日历 `/web/getnotes/remind`（remindStartTime/EndTime）；回收站 `/v2/user/{uid}/invalid/...` |
| 打开笔记 | `POST /notesvr/get/notebody {noteIds}` → **只比对本地 `contentVersion`，不同才更新渲染**；S3 正文先经 `/s3/mappingfilekey` 换 key，再 getObject → toBase64 → decrypt |
| 手动「全部同步」 | emit `EVENT_NOTE_INFO_RELOAD` + `EVENT_RELOAD_NOTE` 全量重拉；动画强制 ≥ 900ms，避免「太快」造成闪烁 |

`visibilitychange` 监听只做 `checkSession()`（account 域 islogin）+ userid 切换检测（换号则 reload），**不拉数据**（B）。

跨设备更新的可见时机 = 重开页面 / 切分组 / 重开笔记，恰好覆盖用户去找「另一台设备写的内容」的全部场景（C：从调用点归纳）。

## 8. 存储架构：S3 直传与 KDrive 影子文件

**S3 直传**（模块 `99ba`，B）：浏览器内直接使用 `window.AWS` SDK。STS 临时凭证（accessKeyId / secretAccessKey / sessionToken / bucket / region / keyPrefix / duration）由 `POST /s3/requestupload`、`POST /s3/requestdownload` **密文下发**，客户端用同一套 AES 模块解密。对象 URL 模式 `{bucket}.s3.{region}.amazonaws.com.cn/{key}`（key 中 `-` 替换为 `/`）。凭证管理：60s 过期窗口、`listObjects(MaxKeys:0)` 探活、失败 3 次重试 + 3s/10s 退避；上传与下载是两个独立凭证实例。外链图片经 `/s3/netpicture/copy` 复制进 S3。

**KDrive 影子文件**（B）：每条新便签在云盘创建 `{标题}.wpsnote` 文件（`/api/v3/groups/{gid}/files/new_empty`，store=`wps_note`），改名时 `PUT /api/v3/groups/{gid}/files/{id}`，并经 `/api/roaminginfos` 记录多端漫游状态。这是便签与 WPS 云文档主生态（多端漫游、迁移到 WPS 笔记）打通的桥。WPS 客户端内嵌场景通过 JS bridge 联动刷新（`window.opener.refreshCurrentList`、`webkit.messageHandlers`）。

## 9. 接口清单（bundle 中实际出现）

均位于 `https://note-api.wps.cn`，除注明外均为 POST（B）：

| 接口 | 用途 |
| --- | --- |
| `/notesvr/get/web-config` | 配置 + `aesPassword`（用户密钥密文） |
| `/notesvr/v2/user/{uid}/home/startindex/{s}/rows/{n}/notes` | GET，home 列表，头 `X-user-key` |
| `/notesvr/v2/user/{uid}/invalid/startindex/{s}/rows/{n}/notes` | GET，回收站列表 |
| `/notesvr/web/getnotes/group` | 分组列表 `{rows, startIndex, groupId}` |
| `/notesvr/web/getnotes/remind` | 日历列表 `{rows, startIndex, remindStartTime, remindEndTime}` |
| `/notesvr/get/notebody` | 批量取正文 `{noteIds}`，返回 `noteBodies[].contentVersion` |
| `/notesvr/v2/getnotebody?uid=&noteids=` | GET，旧版取正文 |
| `/notesvr/set/noteinfo` | 元数据 `{noteId, localInfoVersion, star, remindTime, remindType, groupId?}` |
| `/notesvr/set/notecontent` | 正文 `{title, summary, body, bodyType, localContentVersion}` |
| `/notesvr/set/notegroup` | 分组写操作 |
| `/notesvr/get/noteinfo`、`/notesvr/get/notegroup` | 单条元数据/分组读取 |
| `/notesvr/delete`、`/notesvr/delete/notegroup`、`/notesvr/cleanrecyclebin` | 删除/清空 |
| `/gonote/api/v5/notesvr/recover/notes` | 回收站恢复 |
| `/s3/requestupload`、`/s3/requestdownload` | STS 凭证（密文下发） |
| `/s3/mappingfilekey` | 旧文件 key 换新 key（`{noteId, fileKey, type}`） |
| `/s3/netpicture/copy` | 外链图片复制入 S3 |

drive.wps.cn（GET/PUT/POST 皆有）：`/api/v3/groups/{gid}/files/new_empty`、`/api/v3/groups/{gid}/files/{id}`、`/api/files/{id}/metadata`、`/api/roaminginfos`、`/api/v3/islogin`。

## 10. 「迅速无感」的设计要点

1. **本地优先**：写操作先改内存 + UI，网络后台补偿，用户永远不等网络。
2. **防抖 + 合并 + 串行**：500ms 防抖 → per-note 合并 → 串行队列，请求数是 O(笔记数) 而非 O(编辑次数)。
3. **服务器权威版本号**：客户端不自造版本，冲突交给服务器判定，无三路合并复杂度。
4. **读写版本分离**（info/content）：高频小操作走小包，互不阻塞。
5. **按需 + 版本比对读取**：列表只含密文元数据（很小），正文打开才拉，版本相同零渲染。
6. **大正文外置 S3**：API 报文永远小巧。
7. **全链路密文**：代理/CDN/对象存储看到的都是密文，可放心缓存。
8. **交互点位刷新 + 嵌入桥**：无推送也能覆盖跨设备场景；客户端内嵌走 JS bridge。

## 11. 对本项目的可借鉴点

结合本仓库近期同步优化（outbox 并行、incremental queue、instance epoch）：

- **per-note coalescing 的 outbox**：合并条件是「pending 且非 in-flight」，in-flight 条目允许重复入队，否则丢最后一次编辑。
- **失败跳过而非阻塞重试**：单条失败标记后跳过，保住队列吞吐；重试交给用户可见入口（横幅/按钮）。
- **版本号服务器权威回填**：请求只带「我基于的版本」，不做本地合并。
- **info/content 双轨版本**：把打开/置顶/星标等高频元数据操作从正文同步中拆出。
- **beforeunload 未同步提示**与**打开笔记时 contentVersion 校验**：成本极低、体感提升明显的补丁。

## 12. 参考来源

- 线上样本：`note.wps.cn` 2026-10-24 构建与本目录 2026-08-23 快照。
- [WPS 便签批量导出为 Markdown（知乎）](https://zhuanlan.zhihu.com/p/2068298347400656521) —— 社区对同一套 `/notesvr` 接口的调用实践。
- [WPS便签助手 Chrome 扩展](https://chromewebstore.google.com/detail/wps%E4%BE%BF%E7%AD%BE%E5%8A%A9%E6%89%8B/comnfhdcnamiakeikahbcbjldhbpmnhi)。
- [微软商店 WPS便签页](https://apps.microsoft.com/detail/xp99fl2rglh7hr)（包名 `cn.wps.note`）。
- 同类调研文档：[语雀知识库技术逆向报告](../yuque-knowledge-base-reverse-engineering.md)。
