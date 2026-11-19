# 安全响应头与上线复核

本地基础策略覆盖三条响应路径：Cloudflare 静态资源的 `public/_headers`、Worker API 的 `worker/security-headers.ts`，以及 Node.js 服务器的同一中间件。`deploy/Caddyfile.example` 在 HTTPS 代理边界声明相同策略，避免服务器在代理内仅收到 HTTP 请求时缺少 HSTS。

| 响应头 | 基础值 |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=()` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `object-src 'none'; base-uri 'none'; frame-ancestors 'none'` |
| `Strict-Transport-Security` | `max-age=300`（HTTPS） |

该 CSP 限制插件对象、基础 URL 和外部嵌入，不含 `script-src`，不能视为严格脚本 CSP 或完整的 XSS 防护。首屏主题使用内联脚本，编辑器及其扩展也需兼容性核验；后续应先用 Report-Only 验证脚本的 hash/nonce 策略，再逐步启用，Trusted Types 单独评估。

HSTS 首次使用五分钟缓存，暂不设置 `includeSubDomains` 或 `preload`。正式发布后，先确认域名证书、HTTPS 跳转和各访问入口可持续工作，再逐步提高缓存时间；子域名未经逐一核验前不要纳入策略。`DENY` / `frame-ancestors 'none'` 会禁止通过 iframe 嵌入应用。

## 发布后复核

遵循根目录 `AGENTS.md` 完成版本、测试、构建、标签与正式部署流程，再用公开 GET 请求逐项核对 HTML、静态资源和 API。以下命令不发送访问令牌：

```powershell
curl.exe -sS -D - -o NUL https://note.alover.me/
curl.exe -sS -D - -o NUL https://note.alover.me/snotes.svg
curl.exe -sS -D - -o NUL https://note.alover.me/api/health
```

记录响应状态、采集时间及上表六个响应头，确认 API 鉴权失败和 404 也包含基础策略；浏览器控制台应无新增 CSP 错误，并复测登录、编辑、图片、下载和离线刷新。Cloudflare 静态规则和 Worker 中间件分别生效，不能只检查 `/api/health`。

2026-11-17 修复部署前的正式站点快照见[响应头记录](audits/2026-11-17-security-headers-before.md)。该记录的三个公开路径均未返回上述六个头，本次本地修改尚未改变线上状态。
