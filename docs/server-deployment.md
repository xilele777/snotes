# 部署到自己的服务器

支持 Linux VPS、家用服务器，以及能运行 Node.js 24 的主机。无需 Cloudflare 账号或 GitHub 集成：同一个 Node.js 进程提供网页和 API，SQLite 保存笔记与分组，磁盘保存图片。原来的 Cloudflare 部署方式继续可用。

这是单用户应用，一枚访问令牌允许读写全部笔记。服务器版支持编辑、离线缓存、多设备同步、冲突副本、图片、回收站和写作统计；Cloudflare 用量监控不适用。建议单进程运行，数据目录放在本地持久化磁盘，不要让多个实例共享网络文件系统上的 SQLite。

服务器支持自 `v0.7.0` 起提供。下面的克隆命令固定到该标签；应用内只提醒稳定版更新，预览版请手动到 [Releases](https://github.com/xilele777/snotes/releases) 选择。直接运行 Node.js 已验证；Docker Compose 配置检查通过，但镜像构建和容器运行尚未实测。

## Docker Compose

需要 Docker Engine 与 Compose 插件，宿主机无需安装 Node.js。

```bash
git clone --branch v0.7.1 https://github.com/xilele777/snotes.git
cd snotes
cp server.env.example .env
```

在 `.env` 中设置 `ACCESS_TOKEN` 为至少 32 字节的随机串。可用密码管理器生成，或在安装了 Node.js 的电脑上运行：

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

`.env` 已被 Git 和 Docker 构建上下文排除。`ACCESS_TOKEN` 为空时 Compose 会拒绝启动；令牌只传给后端进程，不会编译进网页。

```bash
docker compose up -d --build
docker compose logs --tail=50 snotes
curl http://127.0.0.1:3000/api/health
# {"ok":true}
```

Compose 将端口绑定到宿主机 `127.0.0.1:3000`，通过下文的 HTTPS 反向代理向外提供服务。修改 `.env` 的 `PORT` 可改变宿主机端口。容器内固定监听 `0.0.0.0:3000`，数据位于命名卷 `snotes-data` 的 `/app/data`；重新构建镜像和重建容器会保留它。不要使用 `docker compose down -v`，该命令会删除数据卷。

`server.env.example` 的 `HOST` 和 `SNOTES_DATA_DIR` 用于直接运行 Node.js；Compose 的监听地址和数据目录由 Dockerfile 固定。

## 直接运行 Node.js

要求 **Node.js 24 LTS**。使用内置 `node:sqlite`，不需要编译第三方 SQLite 扩展；部分 Node.js 24 版本会显示 SQLite 实验性 API 提示。

```bash
git clone --branch v0.7.1 https://github.com/xilele777/snotes.git
cd snotes
npm ci
npm run build:server
cp server.env.example .env.server
```

编辑 `.env.server`，设置自己的 `ACCESS_TOKEN`，然后启动：

```bash
npm start
# 另一终端验证
curl http://127.0.0.1:3000/api/health
```

Windows PowerShell 可以用 `Copy-Item server.env.example .env.server` 代替 `cp`，其余 npm 命令相同。

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `ACCESS_TOKEN` | 无，必填 | API 访问令牌 |
| `ACCESS_TOKEN_FILE` | 无 | 可代替 `ACCESS_TOKEN`，从服务端文件读取令牌；两者都设置时 `ACCESS_TOKEN` 优先 |
| `HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PORT` | `3000` | HTTP 监听端口 |
| `SNOTES_DATA_DIR` | `./data` | 数据目录，相对路径基于启动进程的工作目录；生产环境建议用绝对路径 |

`npm start` 自动读取当前目录的 `.env.server`，现有进程环境变量优先。直接执行 `node dist-server/index.mjs` 时，应由 systemd、Docker 或 shell 注入环境变量。首次启动创建数据库并执行 `migrations/`；后续启动只执行尚未应用的迁移，失败的迁移会回滚并阻止启动。

持久化目录包含：

```text
data/
  snotes.sqlite       笔记、分组、图片索引和同步版本
  snotes.sqlite-wal   SQLite 运行时日志（可能存在）
  snotes.sqlite-shm   SQLite 运行时共享文件（可能存在）
  images/            图片，以笔记 ID / 图片 ID 分目录
```

仅 `dist/` 被公开提供为静态文件，数据和配置不会通过静态资源接口暴露。服务器必须保留 `dist/`、`dist-server/`、`migrations/`、`package.json` 及生产 `node_modules/`。`npm run build:server` 会构建带服务器升级提示的网页；Cloudflare 使用原来的 `npm run deploy`。

## systemd 常驻运行

将项目放在 `/opt/snotes` 并完成构建，创建能读取项目文件的系统用户 `snotes`。把令牌写入 `/etc/snotes.env`，文件内容为 `ACCESS_TOKEN=你的随机令牌`，权限设为仅 root 可读。不要将示例中的相对数据目录复制到该文件。

```bash
sudo cp deploy/snotes.service /etc/systemd/system/snotes.service
sudo systemctl daemon-reload
sudo systemctl enable --now snotes
sudo systemctl status snotes
```

服务文件使用 `/usr/bin/node`，请按 Node.js 的实际安装路径修改。systemd 自动创建 `/var/lib/snotes` 并赋予服务用户写权限；数据保存在这里，更新 `/opt/snotes` 不会覆盖笔记。日志通过 `journalctl -u snotes` 查看，修改令牌后执行 `sudo systemctl restart snotes`。

## HTTPS 和域名

浏览器的 Service Worker、PWA 及部分编辑功能要求安全上下文。`localhost` 可用 HTTP 本地测试；通过域名或服务器 IP 远程使用时应配置 HTTPS，并把网页、`/api/` 和图片一并代理到同一个服务。

推荐 Caddy：把域名解析到服务器，开放 80/443 端口，将 [Caddyfile 示例](../deploy/Caddyfile.example) 中的 `notes.example.com` 换成自己的域名。Caddy 会申请和续期证书：

```caddy
notes.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

这里假定 Caddy 运行在宿主机。若也放在容器中，应连接同一 Docker 网络并代理到 `snotes:3000`。使用 Nginx 等代理时，上传请求体上限设为至少 12 MiB；单张图片上限仍为 10 MiB。

打开 HTTPS 地址后输入访问令牌。每台设备输入一次，不需要 Cloudflare 密钥。GitHub 仅用于源码和可选的更新提醒，无法访问 GitHub 不影响笔记服务。

## 备份、升级与恢复

备份前让客户端完成同步。最简单可靠的方法是停止服务后备份**整个数据目录**，包括 SQLite、可能存在的 WAL/SHM 文件与 `images/`；浏览器里尚未同步的改动不在服务端备份中。

Docker 示例（Linux shell，在项目目录执行）：

```bash
mkdir -p backups
docker compose stop snotes
docker compose run --rm --no-deps --user root --entrypoint tar \
  -v "$PWD/backups:/backup" snotes -czf /backup/snotes-data.tar.gz -C /app/data .
docker compose start snotes
```

每次备份请使用不同文件名保留历史。`backups/` 不要放在公开静态目录或提交到仓库。

升级先阅读 CHANGELOG 并备份，运行 `git status` 检查并保存本地改动。按本文固定标签安装时，先执行 `git fetch origin --tags`，再执行 `git switch --detach <新版本标签>`（将占位符替换成 Releases 中选定的标签），不要在 detached HEAD 上使用 `git pull`。只有跟踪分支的安装才使用 `git pull --ff-only`。

切换代码后，Docker 部署执行 `docker compose up -d --build`；直接运行 Node.js 时先停止服务，再执行 `npm ci`、`npm run build:server`，最后重启服务。数据目录和令牌配置需要保留。迁移在新进程启动时自动完成，首次出现的迁移失败会阻止新服务就绪。联网等待浏览器更新缓存后重新打开应用，在版本弹窗核对版本号。

恢复时先停服务并另存当前数据，将备份解压到一个空的数据目录（Docker 对应 `/app/data` 数据卷），确保文件属于运行服务的用户，再启动。回滚代码不会自动撤销数据库迁移，恢复旧代码时要确认数据库兼容，必要时一起恢复对应备份。

服务器部署默认创建独立数据库，**不会自动搬运已有 Cloudflare D1/R2 数据**。更换域名也会使用新的浏览器本地存储；迁移旧实例应另行导出、核验数据库与图片，不要直接把两个正在使用的实例当成同一个同步服务。

## 验证与排错

```bash
npm run test:server      # SQLite、文件存储、API、迁移与鉴权测试
npm run test:e2e:server  # 在真实 Node.js HTTP 服务上运行整套浏览器测试
```

| 现象 | 检查 |
| --- | --- |
| 缺少 `ACCESS_TOKEN` 导致启动失败 | 设置环境变量、令牌文件或 `.env.server`；Docker 使用 `.env` |
| `node:sqlite` 无法加载 | 使用 Node.js 24 LTS |
| 数据目录只读或权限不足 | 目录需对服务用户可写；Docker 镜像默认用户为 UID 1000，绑定宿主目录时也要匹配权限 |
| 启动提示迁移变更 | 不要修改已经应用过的迁移文件，恢复原文件并以新编号新增迁移 |
| 浏览器图片 401 | 确认同源代理和 `snotes_token` Cookie，令牌须与服务端一致 |
| IP 访问无法安装 PWA 或编辑异常 | 使用 HTTPS 域名；HTTP 仅供 localhost 测试 |
| Cloudflare 用量接口返回 503 | 服务器部署不提供 Cloudflare 额度数据，写作统计不受影响 |
