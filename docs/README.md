# 文档索引

[项目首页](../README.md) · [English overview](../README.en.md)

按使用目的查阅文档。首页介绍项目与快速开始，这里收录完整操作、部署、开发和历史资料。

## 使用

| 文档 | 内容 |
| --- | --- |
| [使用指南](usage.md) | 界面、快捷键、导入导出、回收站、自动清理与访问令牌 |
| [笔记本](knowledge-bases.md) | 独立笔记本、章节目录、离线同步和升级注意事项 |
| [更新日志](../CHANGELOG.md) | 已发布版本的功能与行为变化 |

## 部署与维护

| 文档 | 内容 |
| --- | --- |
| [Cloudflare 部署](cloudflare-deployment.md) · [English](cloudflare-deployment.en.md) | Worker、D1、R2、令牌、域名、升级和额度说明 |
| [服务器部署](server-deployment.md) | Node.js、Docker Compose、systemd、HTTPS、配置、备份与恢复 |
| [运维手册](operations.md) | 同步排错、令牌轮换、D1/R2 备份、迁移和可选用量监控 |

部署到不同后端会使用独立的数据存储，数据不会自动迁移。升级前先同步和备份，不要通过清空浏览器数据来解决尚未确认的同步问题。

## 开发与贡献

- [开发指南](development.md)：本地启动、测试命令、架构、目录分工与贡献要求。
- [维护者发布规范](../CLAUDE.md)：版本号、标签、生产部署及 GitHub Release 流程；当前版本以根目录包配置为准。
- [功能与发布记录](roadmap.md)：需求评估、实施决策和逐版验证结果。

## 设计与历史资料

以下文档用于解释设计过程与历史决策，**不一定反映当前界面或数据行为**。使用和部署请优先参考上面的指南，已发布行为以更新日志为准。

- [界面设计与验收](ui-refresh.md)
- [最初的应用设计](superpowers/specs/2026-08-22-snotes-design.md)
- [最初的实施计划](superpowers/plans/2026-08-22-snotes.md)
- [笔记本设计](superpowers/specs/2026-10-14-knowledge-base-design.md)
- [统一工作区设计](superpowers/specs/2026-10-14-unified-workspace-design.md)

其他阶段性方案保留在 `superpowers/specs/` 与 `superpowers/plans/`，不在项目首页逐项展开。
