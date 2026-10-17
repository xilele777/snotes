<div align="center">

![snotes](https://socialify.git.ci/xilele777/snotes/image?custom_description=%E4%BD%A0%E7%9A%84%E7%AC%94%E8%AE%B0%EF%BC%8C%E4%BD%A0%E7%9A%84%E6%9C%8D%E5%8A%A1%E5%99%A8%E3%80%82%E5%A4%9A%E7%AB%AF%E5%90%8C%E6%AD%A5%EF%BC%8C%E7%A6%BB%E7%BA%BF%E4%B9%9F%E8%83%BD%E5%86%99%E3%80%82&description=1&font=JetBrains+Mono&language=1&name=1&owner=1&pattern=Plus&theme=Light)

# snotes

**你的笔记，你的服务器。多端同步，离线也能写。**

轻量的个人 Markdown 笔记应用，支持部署到 Cloudflare 或自己的服务器。

[![Release](https://img.shields.io/github/v/release/xilele777/snotes)](https://github.com/xilele777/snotes/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)

中文 · [English](README.en.md)

[功能特性](#功能特性) · [快速开始](#快速开始) · [部署指南](#部署方式) · [文档](#文档) · [更新日志](CHANGELOG.md)

</div>

## 简介

snotes 面向想自己掌握数据的个人用户：随手记录日常笔记，用笔记本整理长文档，在电脑和手机之间继续写作。

笔记先保存在浏览器本地，联网后与自己的服务端同步。前端与 API 既可以运行在 Cloudflare Workers 上，也可以由一个 Node.js 服务提供；不需要依赖第三方笔记平台。

> **项目定位：单用户、自托管。** 使用实例访问令牌登录，不提供多用户账户或协作编辑。Agent 可使用按笔记本授权的独立凭证。

## 功能特性

- **离线优先** — 已同步到设备的笔记可以离线阅读和编辑，重新联网后自动同步。
- **Markdown 写作** — 支持标题、列表、待办、表格、代码块、图片与高亮，撤销、重做和插图集中在格式工具栏，低频管理收进更多菜单，支持阅读模式和专注模式。
- **两种整理方式** — 普通笔记支持分组、星标、置顶和搜索，可从列表菜单快速整理；笔记本提供章节目录与最近更新入口，支持移出为独立笔记。
- **多设备同步** — 正文与属性分别同步，并发编辑保留冲突副本，便于人工合并。
- **历史与恢复** — 自动保存正文历史；普通删除提供 5 秒撤销；回收站支持预览和恢复，笔记本目录中的笔记可恢复到原位置。
- **数据可携带** — 导入 Markdown 或备份包，导出包含图片和属性的 Markdown ZIP，支持单篇下载、分享与打印。
- **桌面与手机** — 响应式界面、深浅色主题和 PWA 安装；支持图片灯箱与系统分享入口，具体能力取决于浏览器。
- **写作统计** — 查看字数、连续写作、活动热力图、分组分布与跨设备打开记录。

## 快速开始

### 使用 Node.js 运行

需要 **Node.js 24 LTS**。不需要 Cloudflare 账号，笔记存入 SQLite，图片保存在本地磁盘。

```bash
git clone --branch v0.23.3 https://github.com/xilele777/snotes.git
cd snotes
npm ci
npm run build:server
cp server.env.example .env.server
```

编辑 `.env.server`，将 `ACCESS_TOKEN` 设置为自己的随机令牌，然后启动：

```bash
npm start
```

打开 **<http://127.0.0.1:3000>**，输入令牌即可使用。首次启动会自动创建数据库并应用迁移。

<details>
<summary>如何生成令牌？Windows 如何复制配置文件？</summary>

生成至少 32 字节的随机令牌：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

在 Windows PowerShell 中，用下面的命令代替 `cp`：

```powershell
Copy-Item server.env.example .env.server
```

不要提交 `.env.server`，也不要把示例令牌用于公网部署。

</details>

默认数据目录为 `data/`。升级时保留整个目录；远程访问请配置 **HTTPS 反向代理**。完整步骤见[服务器部署指南](docs/server-deployment.md)。

### 部署方式

| 方式 | 适合的场景 | 数据存储 | 指南 |
| --- | --- | --- | --- |
| **Cloudflare** | 不想维护独立服务器 | D1 + R2 | [部署与升级](docs/cloudflare-deployment.md) |
| **Node.js** | 已有 VPS、家用服务器或本地主机 | SQLite + 本地图片目录 | [服务器部署](docs/server-deployment.md#直接运行-nodejs) |
| **Docker Compose** | 希望用容器管理服务 | SQLite + 持久化数据卷 | [Compose 部署](docs/server-deployment.md#docker-compose) |

Cloudflare 部署需要创建自己的 D1 数据库和 R2 桶，替换仓库中的资源配置，并设置访问令牌。免费额度与费用以平台政策和实际用量为准。

> **验证范围：** Cloudflare 和直接运行 Node.js 已完成集成及浏览器测试；Docker Compose 目前仅验证了配置，尚未实测镜像构建和容器运行。

固定版本安装请使用 [Releases](https://github.com/xilele777/snotes/releases) 中的标签；`main` 可能包含未发布改动。升级前先同步并备份，按对应部署指南操作。应用内更新提醒不会自动升级服务端。

## 数据与安全

- **令牌就是访问权限。** 持有 `ACCESS_TOKEN` 的人可以读写整个实例的笔记和图片，请使用随机令牌并妥善保管。
- **自托管不等于端到端加密。** 请使用 HTTPS，并保护服务器、数据库、图片目录和备份。
- **离线缓存不等于备份。** 浏览器可能清理本地存储；尚未同步的改动不会出现在服务端备份中。
- **优先使用应用内导出迁移。** 在「设置 → 数据」导出完整备份包。服务端备份还需覆盖图片；D1 SQL 导出不包含 R2 对象。
- **注意永久删除。** 普通删除进入回收站；删除整本笔记本会永久删除其中内容，不经过回收站。

更多说明见[使用指南](docs/usage.md)、[备份与排错](docs/operations.md)及[服务器备份与恢复](docs/server-deployment.md#备份升级与恢复)。

## 开发

建议使用 **Node.js 24 LTS**，以同时运行前端、Worker 和 Node.js 后端测试。

```bash
npm ci
npm run test:all
npm run build
```

本地开发启动、环境配置、浏览器测试和架构说明见[开发与贡献](docs/development.md)。

| 层 | 技术 |
| --- | --- |
| 界面与编辑器 | Vue 3 · Pinia · Milkdown |
| 离线与 PWA | Dexie / IndexedDB · Workbox |
| API | Hono · Cloudflare Workers / Node.js |
| 存储 | D1 / SQLite · R2 / 本地磁盘 |
| 验证 | TypeScript · Vitest · Playwright |

## 文档

| 我想…… | 查看 |
| --- | --- |
| 了解界面、快捷键和数据导入导出 | [使用指南](docs/usage.md) |
| 使用笔记本和章节目录 | [笔记本说明](docs/knowledge-bases.md) |
| 让 Agent 写入笔记本，配置 MCP 或 API | [Agent 接入](docs/agent-access.md) |
| 部署到 Cloudflare | [Cloudflare 部署](docs/cloudflare-deployment.md) |
| 使用 Node.js、Docker、systemd 或 HTTPS | [服务器部署](docs/server-deployment.md) |
| 升级、备份或排查同步问题 | [运维手册](docs/operations.md) |
| 参与开发、运行测试或了解目录结构 | [开发与贡献](docs/development.md) |
| 查看版本变化 | [更新日志](CHANGELOG.md) · [Releases](https://github.com/xilele777/snotes/releases) |

设计文档与历史实施记录收录在[文档索引](docs/README.md)，不作为当前功能承诺。

## 参与贡献

欢迎通过 [Issues](https://github.com/xilele777/snotes/issues) 反馈可复现的问题或提出建议，也欢迎提交 Pull Request。贡献前请阅读[开发说明](docs/development.md#贡献代码)。

安全问题请通过 [GitHub Security Advisory](https://github.com/xilele777/snotes/security/advisories/new) 私下报告，不要在公开 Issue 中泄露令牌或笔记数据。

## 许可证

[MIT](LICENSE) © xilele777
