# Agent 接入

snotes 提供独立的 Agent HTTP API 与远程 MCP，让 Agent 在指定笔记本中保存和维护 Markdown。Cloudflare Workers 和 Node.js 共用同一套接口。

## 创建凭证

1. 创建目标笔记本并完成同步。
2. 在「设置 → Agent 接入」填写名称，选择笔记本、权限和有效期。
3. 复制密钥或包含密钥的 MCP 配置。完整密钥仅在创建后显示一次。

新建的其他笔记本不会自动获得授权。权限需要变更时，创建新凭证再撤销旧凭证。请通过客户端的私密配置或环境变量注入密钥，不要放入项目仓库或公开文档；公网连接使用 HTTPS。

| 权限 | 能力 |
| --- | --- |
| `read` 读取 | 搜索笔记、读取完整 Markdown |
| `create` 新建 | 新建笔记与章节，指定父章节 |
| `update` 修改 | 替换正文或追加 Markdown |

所有凭证都能列出授权笔记本、查看目录、笔记标题和内容版本。只授予新建权限适合文档投递；读取与修改权限适合持续更新。当前不提供 Agent 删除、跨笔记本移动、图片上传或实例管理能力。

实例的 `ACCESS_TOKEN` 用于所有者登录和凭证管理，不能作为 Agent 密钥。Agent 密钥也不能访问普通同步、图片、回收站、监控或凭证管理接口。

## MCP

地址：`https://你的域名/api/mcp`。使用 **Streamable HTTP**、无会话 JSON 响应，以及 `Authorization: Bearer <密钥>`。支持标准初始化、工具发现与调用，每次请求均检查凭证。GET 返回 405，服务没有事件流。

支持 URL 与自定义请求头的客户端可以参考下列配置，实际字段以客户端要求为准：

```json
{
  "mcpServers": {
    "snotes": {
      "url": "https://你的域名/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_AGENT_TOKEN" }
    }
  }
}
```

仅支持本地 stdio、要求 OAuth 登录或不能配置 Bearer 请求头的客户端，需要相应的本地桥接程序；当前不提供 OAuth 流程。

如果部署前还有 Cloudflare Access，Agent 也必须通过网关认证。使用 Access 服务令牌时，在客户端配置中同时加入 `CF-Access-Client-Id` 和 `CF-Access-Client-Secret` 请求头，并确保网关策略允许该服务令牌。snotes 的 Agent 密钥仍放在 `Authorization` 中，两层凭证分别配置；浏览器中的 Access 登录状态不会自动传给其他 Agent。

| 工具 | 参数 |
| --- | --- |
| `list_notebooks` | 无参数，返回授权笔记本和权限 |
| `get_notebook` | `notebook_id`，返回目录节点、笔记 ID、标题与版本 |
| `search_notes` | `notebook_id`、`query`、可选 `offset` |
| `get_note` | `notebook_id`、`note_id` |
| `create_folder` | `notebook_id`、`title`、可选 `parent_id`、`operation_id` |
| `create_note` | `notebook_id`、`content`、可选 `parent_id`、`operation_id` |
| `update_note` | `notebook_id`、`note_id`、`content`、`base_version`、`operation_id` |
| `append_note` | 同上，在原正文后以空行分隔追加 |

示例指令：“把这份设计文档保存到项目资料笔记本的接口设计章节，返回笔记链接。” 建议在 Agent 的项目指令中指定目标，并要求更新前读取正文、发生冲突时重新读取并合并。

## HTTP API

所有请求使用 `Authorization: Bearer <Agent 密钥>`；写请求使用 `Content-Type: application/json`。基础路径为 `/api/agent/v1`。

| 方法与路径 | 功能 |
| --- | --- |
| `GET /notebooks` | 列出授权笔记本与权限 |
| `GET /notebooks/{book}` | 查看目录 |
| `GET /notebooks/{book}/notes?query=关键词&offset=0` | 搜索，每页最多 50 条，返回 `next_offset` |
| `GET /notebooks/{book}/notes/{note}` | 读取 Markdown 与版本 |
| `POST /notebooks/{book}/folders` | 创建章节 |
| `POST /notebooks/{book}/notes` | 新建并归档笔记 |
| `PATCH /notebooks/{book}/notes/{note}` | 替换正文 |
| `POST /notebooks/{book}/notes/{note}/append` | 追加正文 |

HTTP 写请求字段同上表 MCP 参数，但笔记本和笔记 ID 由路径提供。例如将密钥存入 `SNOTES_AGENT_TOKEN` 环境变量后：

```bash
curl 'https://你的域名/api/agent/v1/notebooks/BOOK_ID/notes' \
  -H "Authorization: Bearer $SNOTES_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"operation_id":"report-20261016-01","content":"# 调研报告\n\n这里是正文。"}'
```

`parent_id` 省略或为 null 时写入根目录，否则必须是该笔记本的章节节点 ID。标题、摘要、缩略图由服务端从 Markdown 派生。

成功返回 `notebook_id`、`note_id`（章节为 null）、`node_id`（创建操作）、内容 `version`、`toc_version`、`update_time` 和相对地址 `url`。将 URL 与部署域名拼接即可打开；未登录时先登录，再同步并定位笔记。修改按既有规则保留历史；其他设备通过正常同步获取改动，前台页面可等待下一次轮询或手动同步。

## 重试、冲突与限制

每次写入必须提供新的 `operation_id`，推荐 UUID，允许 1–100 个字母、数字、下划线或连字符。

- 网络重试保持同一凭证、同一操作、相同参数与 `operation_id`，服务返回原始回执，不重复创建或追加。
- 新的编辑使用新的操作 ID。修改和追加必须提供刚读取的 `base_version`。
- HTTP 409 `version_conflict` 返回 `current_version`，原文保持不变。重新读取并合并，使用新的操作 ID 提交。MCP 在 `isError: true` 的工具结果中返回同样的错误。
- 目录竞争由服务端重读并尝试最多 3 次，仍失败返回 409 `write_conflict`，可以保持原参数重试。
- 同一操作 ID 搭配不同参数或工具返回 409 `operation_reused`。

正文、目录归档、同步版本、历史和成功记录在同一数据库事务中提交，失败不会留下半成品。Agent 不会恢复回收站笔记或写入不可用笔记本。历史导入若让笔记被未授权的其他有效笔记本共同引用，修改返回 403 `shared_note_outside_scope`。

| 状态 | 含义 |
| --- | --- |
| 400 | JSON 或参数错误 |
| 401 | 密钥无效、过期或撤销 |
| 403 | 权限不足，或其他网页 Origin |
| 404 | 笔记本不在范围或不可用，笔记不存在或不属于该本 |
| 409 | 版本冲突、目录竞争、操作 ID 重用 |
| 413 | 请求体超过 2 MiB |
| 422 | 父章节不存在、目录超过限制、追加后正文过大 |

单次输入 Markdown 最多 500,000 个 UTF-16 字符且 UTF-8 不超过 1,000,000 字节；追加后的完整正文也不能超过 1,000,000 字节。仍遵循每本最多 1,000 节点和 8 层目录的限制。一枚凭证最多授权 100 本。

浏览器请求只接受当前 API 同源的 Origin；本地 Agent 和脚本通常不发送 Origin。Node.js 继续使用既有登录失败限流；Cloudflare 可结合平台的访问与速率规则。

## 审计、升级与备份

所有者通过 `/api/agent-tokens` 创建与查看凭证，`DELETE /api/agent-tokens/{id}` 撤销凭证，`GET /api/agent-tokens/activity` 查看最近 50 次成功写入。重复请求只记录一次。记录不含正文和原始密钥，保留来源、目标、操作类型、请求摘要和回执，不随正文历史修剪，以便识别较早的网络重试。

迁移为 `migrations/0009_agent_access.sql`。Node.js 启动时自动应用；Cloudflare 发布前运行 `npx wrangler d1 migrations apply snotes --remote`，数据库名称按部署配置替换。

应用内笔记备份不包含 Agent 凭证和操作回执；完整数据库备份会包含它们。通过应用内备份迁移到新实例后，需要重新创建凭证。
