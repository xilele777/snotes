# 1.0.0 发布验收与恢复演练

应用版本已准备为 1.0.0，生产尚未发布。已建立并实测独立 Cloudflare staging，Docker/CDN 实际验收已完成；原始证据、部署标识和限制见[最终验收补充](audits/2026-10-20-v1-acceptance.md)。自动化结果与真实设备验收分别记录；未运行项目不能写为已通过。

最终 1.0.0 复验：`test:all` **1,032/1,032**，`build` / 类型检查 / 体积预算通过，PWA 生命周期 **2/2**，最终 Docker 镜像运行/恢复通过，生产依赖审计 **0 vulnerabilities**。

## 自动化验收入口

```bash
npm run test:all
npm run build
npm run check:bundle
npm run test:e2e:server
npm run test:e2e
```

共享恢复 contract 在 Node SQLite 和本地 Worker D1 分别执行：同水位正文替换、笔记本独立变化、跨域凭证、epoch 改变。Node 实例演练覆盖普通回收站/历史/无引用图片、哈希损坏拒绝、拒绝覆盖已有目录、旧客户端写入限制。浏览器两标签页测试覆盖离线最后输入和实际等待中的 Service Worker 接管，不能替代历史版本升级链或手机进程回收。

## Cloudflare 专用 staging

必须使用与生产独立的 Worker、D1、R2、域名与访问凭证。停写/恢复演练不得在生产执行。准备空白实例并应用迁移、部署候选版本后，在 PowerShell 中运行：

```powershell
$env:SNOTES_STAGING_URL = 'https://YOUR-DEDICATED-STAGING'
$env:SNOTES_STAGING_TOKEN = '专用测试令牌'
$env:SNOTES_STAGING_DEDICATED = 'true'
node scripts/accept-staging.mjs
```

脚本拒绝已有笔记、分组或笔记本的实例，实际创建 101 和 1000 条记录，验证 80 条分页、50 条正文读取、R2 上传/字节读取/匿名 401，输出 tmp/acceptance/staging-acceptance.json。测试数据保留用于恢复演练，完成后删除专用实例；脚本不修改生产配置，也不会部署。输出仅含测试记录 ID，不含令牌。

可复制的资源创建与隔离配置见[Cloudflare 部署](cloudflare-deployment.md#独立-staging-与验收)。批量完成后运行真实恢复和 CDN 核验：

```powershell
node scripts/drill-staging-recovery.mjs wrangler.staging.local.jsonc
node scripts/accept-cdn.mjs
```

恢复脚本校验 acceptance 命名及专用配置，实际执行远端 D1 Time Travel 和 epoch secret 更新；不要用于生产。CDN 检查应在本机 dist 与该次 staging 部署一致时运行。四个脚本的 JSON 输出统一放在被忽略的 tmp/acceptance/，复核后将证据归档到 docs/audits；不要提交环境文件。

恢复演练：保存 SQL 与全部 R2；让设备 A/B 拉取，B 离线编辑；创建新笔记/笔记本并修改历史；进入维护窗口，恢复快照，轮换外部 epoch 并启用严格模式；重新开放后检查 A/B 都先对账再上传，远端缺失内容有恢复副本、目录差异有快照、两域游标仅在清单完整时推进。重复“仅恢复笔记本表”“相同水位”“中断第二页”“对账时再次切换 epoch”；旧客户端无 epoch 写入应返回 409。保留 SQL 摘要、epoch、请求日志和测试时间。

完整 D1/R2 备份仍需停写协调并核验对象清单；Node 的文件备份工具不适用于 Cloudflare 远端资源。

## Docker 与 CDN

构建 Dockerfile，以独立临时数据卷启动；检查 health、登录、图片上传、容器重启持久化、实例备份/恢复及恢复后的旧客户端 409。部署反向代理后，对 main/Lute 同时检查 gzip 或 br、Vary、hash 静态资源 immutable、HTML/sw 不长期缓存；下载解压后逐字节对照构建产物。Node 的压缩单测不能替代真实代理/CDN。

可复跑本地隔离验收（只删除脚本自己创建的容器和卷）：

```bash
docker build -t snotes:acceptance-local .
node scripts/accept-docker.mjs snotes:acceptance-local
```

## 真机与真实旧 PWA

| 环境 | 操作及通过条件 | 状态 |
| --- | --- | --- |
| iPhone Safari + 主屏 PWA | 中文拼音候选未上屏时切笔记/后台，确认候选提交与正文无丢字；粘贴、撤销、键盘焦点正常 | 用户要求暂缓 |
| Android Chrome + 中文输入法 | 同上，另测离线编辑后切后台与网络恢复 | 用户要求暂缓 |
| 后台/低内存 | 系统回收页面后重开，本地已保存内容仍在；未保存失败有可下载草稿 | 手机真机暂缓 |
| 已安装的旧版本 PWA | 两标签页留输入，仅一页批准更新；检查交接保存 | 新版实际接管已通过；完整历史版本链待验，旧版首升要求先同步并关闭旧页 |
| Cloudflare staging | 101/1000 批量、R2、两域与同水位恢复、旧客户端限制 | 已通过，见原始证据 |
| Docker/CDN | 容器持久化、恢复、真实传输与缓存头 | 已通过，Docker 临时资源已清理 |

记录设备型号、OS/浏览器/输入法版本、应用版本、日期、步骤、预期/实际及日志。Playwright Chromium/WebKit 模拟不代表 iOS Safari 真机已通过。
