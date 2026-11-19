# 2026-11-17 正式站点安全响应头快照（修复前）

仅执行公开 GET 请求，未携带令牌，未读取用户笔记；以下为修复部署前的线上状态。

采集时间：2026-11-17T12:09:53+08:00（Asia/Shanghai）

## `/`

- 状态：200
- 响应日期：Tue, 17 Nov 2026 04:09:55 GMT
- Content-Type：`text/html`

| 响应头 | 值 |
| --- | --- |
| Content-Security-Policy | 未返回 |
| Strict-Transport-Security | 未返回 |
| X-Content-Type-Options | 未返回 |
| Referrer-Policy | 未返回 |
| Permissions-Policy | 未返回 |
| X-Frame-Options | 未返回 |

## `/snotes.svg`

- 状态：200
- 响应日期：Tue, 17 Nov 2026 04:09:55 GMT
- Content-Type：`image/svg+xml`

| 响应头 | 值 |
| --- | --- |
| Content-Security-Policy | 未返回 |
| Strict-Transport-Security | 未返回 |
| X-Content-Type-Options | 未返回 |
| Referrer-Policy | 未返回 |
| Permissions-Policy | 未返回 |
| X-Frame-Options | 未返回 |

## `/api/health`

- 状态：200
- 响应日期：Tue, 17 Nov 2026 04:09:56 GMT
- Content-Type：`application/json`

| 响应头 | 值 |
| --- | --- |
| Content-Security-Policy | 未返回 |
| Strict-Transport-Security | 未返回 |
| X-Content-Type-Options | 未返回 |
| Referrer-Policy | 未返回 |
| Permissions-Policy | 未返回 |
| X-Frame-Options | 未返回 |

本记录不能代表修复后状态；发布后须重新采集。`frame-ancestors` 属于 CSP 指令，本次 CSP 未返回，因此该指令亦未返回。
