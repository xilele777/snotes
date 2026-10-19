# 1.0.0 候选版验收补充

日期：2026-10-20（Asia/Shanghai；原始证据使用 UTC，跨日记录见 JSON）。应用版本已准备为 **1.0.0**；本文记录候选版验证，不等于生产已发布。此前 2026-10-19 的审查与修复记录保留为历史基线。

## 四项问题的处理结果

| 问题 | 已完成 | 保留边界 |
| --- | --- | --- |
| 服务器恢复协议 | 0011 迁移加入两个同步域共用实例 epoch、独立 revision/checkpoint；笔记本完整 ID 清单；上传前对账；缺失笔记本生成独立恢复副本；旧 epoch 写入拒绝 | 完整快照必须在维护窗口轮换数据库外 epoch；所有写入含 Agent/维护必须停止并排空。恢复副本可能需要人工合并 |
| 图片保留 | 保留已提交图片防跨笔记/离线引用误删；未发布图片在元数据写入失败时补偿删除；界面、README、发布说明均披露 | 图片引用与删除协调协议未实现；删除笔记不擦除图片，持有效凭证和已知地址仍可能读取；存储会累积 |
| 备份范围 | 默认格式 3 含全部本机回收站、本地普通历史及历史图片；保留格式 1/2 导入。Node 离线实例工具保存全部数据库及全部磁盘图片，校验哈希/完整性后恢复 | 应用 ZIP 为合并导入，仅含本机范围；云端图片上传不在本地事务内，失败仍可能留孤立对象。Cloudflare 完整备份需另保存 D1 + 全部 R2 |
| 环境验收 | 专用 Cloudflare 101/1000 批量与 R2、实际 D1 Time Travel 恢复、同水位笔记本变化、缺失清单、CDN、Docker 持久化/恢复及新版两标签页接管 | 用户明确暂缓 iOS/Android 真机；手机中文输入法、低内存进程回收未验证。首次从旧版升级需先同步并关闭旧标签页 |

## 验证证据

最终 1.0.0 的 `npm run test:all` 复验为前端/shared **771**、Worker **191**、Node **70**，共 **1,032** 项通过；最终蓝色图标已生成全部尺寸；`npm run build` 与 `check:bundle` 复验通过，生产依赖审计 0 vulnerabilities，109 个当前指南的本地链接有效。生产构建、类型检查和资源预算通过：main gzip 96,633 B / 解码 299,848 B，Vditor gzip 77,623 B / 解码 311,928 B，Lute gzip 601,698 B / 解码 3,743,299 B。

1.0.0 的 recovery-lifecycle 最终复验 **2/2** 通过。Node 完整 Chromium 回归 101/101 通过后，最终 PWA 逻辑另跑 recovery-lifecycle 2/2；Worker 完整浏览器 102/102 通过（独立控制器监听增加前）。两标签页用例实际安装等待中的 Service Worker 并触发接管，覆盖各页面最后中文输入落库；它使用候选版页面和测试 worker，不能表述为已完整验证所有历史版本 PWA 升级链。0.24.1 旧页面没有保存交接代码，首升按部署文档先同步、导出、关闭旧窗口。

| 证据 | 内容 |
| --- | --- |
| [staging-acceptance.json](2026-10-20-acceptance/staging-acceptance.json) | 101 + 1000 条笔记创建、完整分页与分批正文；R2 字节一致和匿名 401 |
| [staging-recovery.json](2026-10-20-acceptance/staging-recovery.json) | 真实远端 Time Travel 回滚；外部 epoch 轮换后两个域旧凭证失效、旧写入拒绝；同水位笔记本变化和完全缺失清单 |
| [staging-cdn.json](2026-10-20-acceptance/staging-cdn.json) | main/Lute/HTML/sw gzip、Vary、immutable/no-cache；解压字节与同次本地构建一致 |
| [docker-1.0.0-acceptance.json](2026-10-20-acceptance/docker-1.0.0-acceptance.json) | 最终 1.0.0 蓝色图标镜像复验，全部容器/重启/备份恢复/epoch 检查通过 |
| [docker-acceptance.json](2026-10-20-acceptance/docker-acceptance.json) | 实际镜像运行、笔记/图片鉴权、gzip/cache/hash、重启持久化；停服完整备份/恢复含历史/普通回收站/无引用图片；新 epoch 可写、缺失或旧 epoch 返回 409 |

staging：`snotes-acceptance-20261019`，Worker/D1/R2 全独立，地址为 https://snotes-acceptance-20261019.2519175810.workers.dev 。最终部署 Version ID：`c60e5aeb-7143-4cb0-b338-ac3677b163e4`，该次产物应用版本为 0.24.1，属于未发布候选源码验证。生产资源未修改。测试数据保留在专用实例供复核；资源会占用账户额度，复核后按配置精确删除专用 Worker、D1、R2。配置和凭证在被忽略的 `tmp/acceptance/`，不写入证据。

Docker 另使用原 Dockerfile 完成最终 `snotes:1.0.0-local` 构建并复验，镜像 ID 为 `sha256:882179ce8781e17eabd41a0d2f73e01dbd583d7d7222ee7b786dc9eff58868cc`。此前成功构建 `snotes:acceptance-20261019`，验收仅绑定 127.0.0.1:8792；已删除本轮测试容器和两个卷，保留镜像。容器内容在 Linux 构建，与宿主 Windows 构建可能有细微差异，HTTP 核验对照镜像自身的产物。Docker 镜像没有发布到镜像仓库。未修改已有容器或全局 Docker 配置。

## 发布准备

版本号、lock 根版本、CHANGELOG、安装示例统一为 1.0.0；代码、文档与版本准备按主题拆分提交。正式候选复验已执行 `npm run test:all`、`npm run build` 和体积预算，均通过。正式发布仍需根据 AGENTS.md 推送注解标签、应用生产迁移、部署并记录真实生产 Version ID、创建 GitHub Release；staging ID 不能替代生产记录。真机暂缓及图片/备份边界保留在正式说明中。
