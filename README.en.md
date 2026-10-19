<div align="center">

<img src="public/snotes.svg" width="88" height="88" alt="snotes blue bookmark icon" />

# snotes

**Your notes. Your server. Every device. Even offline.**

A lightweight personal Markdown notebook, self-hosted on Cloudflare or your own server.

[![Release](https://img.shields.io/github/v/release/xilele777/snotes)](https://github.com/xilele777/snotes/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)

[中文](README.md) · English

[Features](#features) · [Quick start](#quick-start) · [Deployment](#deployment-options) · [Documentation](#documentation) · [Changelog](CHANGELOG.md)

</div>

## Overview

snotes is for people who want to own their notes: capture everyday thoughts, organize longer documents in notebooks, and continue writing across desktop and mobile.

Notes are saved in the browser first, then synced with your own backend. Run the same frontend and API on Cloudflare Workers or in a single Node.js service, without depending on a third-party note-taking platform.

> **Single-user and self-hosted.** An instance access token signs in the owner. Agents can use separate credentials scoped to selected notebooks. There are no multiple-user accounts or collaborative editing.

## Why snotes

snotes combines offline writing, personal knowledge organization, and scoped Agent access in a web app you can host yourself.

| What you need | How snotes helps |
| --- | --- |
| Capture thoughts without waiting for the network | Notes save in the browser first. Downloaded content stays editable offline and syncs when reconnected; the PWA can be installed on desktop and mobile |
| Organize quick notes and lasting reference material differently | Use groups, stars, and pins for everyday notes, or chapter trees for project notebooks; move notebook notes out as independent notes |
| Let an Agent maintain documents with limited access | Built-in MCP and HTTP APIs grant read, create, and update permissions per notebook, with expiring and revocable credentials |
| Choose where your data lives | Deploy the same app on Cloudflare Workers + D1 + R2, or Node.js / Docker + SQLite + image files on disk |
| Keep notes portable and recover from mistakes | Markdown ZIPs carry images and properties; local history and trash can be backed up. Concurrent body edits retain conflict copies, and Node includes a full-instance backup tool |

Designed for personal notes, project knowledge, and notebooks shared with an Agent. The app is single-user, body conflicts require manual merging, and offline storage and sync need regular backups.

## Features

- **Offline-first** — Read and edit notes already synced to the device, then sync automatically when reconnected.
- **Markdown writing** — Headings, lists, tasks, tables, code blocks, images, and highlights, with undo, redo, and image insertion in Vditor's formatting toolbar, a quieter management menu, and native editor fullscreen.
- **Two ways to organize** — Groups, stars, pins, and search for everyday notes, with list menus for quick organization. Notebooks provide recent-note links and chapter trees. Move a note out of its notebook to keep it as an independent note.
- **Device sync** — Bodies and properties sync separately. Concurrent edits retain conflict copies for manual merging.
- **History and recovery** — Automatic body history, five-second undo for soft deletion, trash previews, and recovery to the original notebook location after deleting a directory note.
- **Portable data** — Import Markdown or backups; export Markdown ZIPs with images and properties. Download, share, or print individual notes.
- **Desktop and mobile** — Responsive layouts, light and dark themes, PWA installation, image lightboxes, and system sharing where supported by the browser.
- **Writing statistics** — Word counts, streaks, an activity heatmap, group distribution, and opens across devices.
- **Agent access** — MCP / HTTP APIs deliver and maintain Markdown in selected notebooks using separate credentials with scoped permissions and expiry.

## Quick start

### Run with Node.js

Requires **Node.js 24 LTS**. No Cloudflare account is needed: notes use SQLite and images are stored on disk.

```bash
git clone --branch v1.0.0 https://github.com/xilele777/snotes.git
cd snotes
npm ci
npm run build:server
cp server.env.example .env.server
```

Edit `.env.server` and set `ACCESS_TOKEN` to your own random token, then start the service:

```bash
npm start
```

Open **<http://127.0.0.1:3000>** and enter your token. The first start creates the database and applies migrations automatically.

<details>
<summary>Generate a token / copy configuration on Windows</summary>

Generate a token with at least 32 random bytes:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

In Windows PowerShell, replace `cp` with:

```powershell
Copy-Item server.env.example .env.server
```

Do not commit `.env.server` or use an example token on a public deployment.

</details>

Data defaults to `data/`. Preserve the entire directory during upgrades and configure an **HTTPS reverse proxy** for remote access. See the [server deployment guide (Chinese)](docs/server-deployment.md).

### Deployment options

| Option | Best for | Storage | Guide |
| --- | --- | --- | --- |
| **Cloudflare** | Running without a separate server | D1 + R2 | [Deploy and upgrade](docs/cloudflare-deployment.en.md) |
| **Node.js** | A VPS, home server, or local machine | SQLite + images on disk | [Server setup (Chinese)](docs/server-deployment.md#直接运行-nodejs) |
| **Docker Compose** | Container-managed services | SQLite + a persistent volume | [Compose setup (Chinese)](docs/server-deployment.md#docker-compose) |

Cloudflare deployment requires your own D1 database and R2 bucket, updated resource settings, and an access token. Costs depend on platform policies and actual usage; free operation is not guaranteed.

> **Verification status:** Both backends have browser regression coverage. Dedicated Cloudflare D1/R2 batch and recovery drills, public CDN checks, and Docker image builds, persistence, and instance recovery have passed. iOS / Android device tests are deferred; see the [acceptance record (Chinese)](docs/release-acceptance.md).

For pinned installations, select a tag from [Releases](https://github.com/xilele777/snotes/releases). `main` may include unreleased changes. Sync and back up before upgrading, then follow the guide for your deployment. In-app notifications do not upgrade your server automatically.

## Data and security

- **The token grants access to everything.** Anyone with `ACCESS_TOKEN` can read and write all notes and images. Generate it randomly and keep it private.
- **Self-hosting is not end-to-end encryption.** Use HTTPS and protect the server, database, image storage, and backups.
- **Offline storage is not a backup.** Browsers can clear local storage. Unsynced changes are not included in server backups.
- **Distinguish migration archives from instance backups.** Settings → Data exports format 3 with local notes, trash, local history, and referenced images. Server-only data and unreferenced images need a server backup; a D1 SQL export excludes R2 objects.
- **Understand permanent deletion.** Regular note deletion uses trash. Deleting an entire notebook permanently deletes its contents without using trash.
- **Images are retained.** Deleting a note or notebook does not erase uploaded images. Valid credentials and a known URL may still retrieve them, and storage accumulates. Coordinated image reference tracking and deletion are not implemented.

See the [usage guide (Chinese)](docs/usage.md), [operations guide (Chinese)](docs/operations.md), and [server backup and recovery (Chinese)](docs/server-deployment.md#备份升级与恢复).

## Development

Use **Node.js 24 LTS** to run both frontend/Worker and Node.js backend tests.

```bash
npm ci
npm run test:all
npm run build
```

Local setup, environment configuration, browser tests, and architecture are documented in the [development guide (Chinese)](docs/development.md).

| Layer | Technology |
| --- | --- |
| UI and editor | Vue 3 · Pinia · Milkdown |
| Offline and PWA | Dexie / IndexedDB · Workbox |
| API | Hono · Cloudflare Workers / Node.js |
| Storage | D1 / SQLite · R2 / local disk |
| Verification | TypeScript · Vitest · Playwright |

## Documentation

| Topic | Guide |
| --- | --- |
| Interface, shortcuts, and import/export | [Usage (Chinese)](docs/usage.md) |
| Notebooks and chapter trees | [Notebooks (Chinese)](docs/knowledge-bases.md) |
| Connect Agents through MCP or HTTP API | [Agent access (Chinese)](docs/agent-access.md) |
| Cloudflare deployment and upgrades | [Cloudflare deployment](docs/cloudflare-deployment.en.md) |
| Node.js, Docker, systemd, and HTTPS | [Server deployment (Chinese)](docs/server-deployment.md) |
| Backups and sync troubleshooting | [Operations (Chinese)](docs/operations.md) |
| Development, tests, and project layout | [Development (Chinese)](docs/development.md) |
| Release changes | [Changelog (Chinese)](CHANGELOG.md) · [Releases](https://github.com/xilele777/snotes/releases) |

Design documents and implementation history are listed in the [documentation index (Chinese)](docs/README.md). They are not promises of currently available features.

## Contributing

Reproducible bug reports, feature suggestions, and pull requests are welcome. Start with [Issues](https://github.com/xilele777/snotes/issues) and the [contribution guide (Chinese)](docs/development.md#贡献代码).

Please report security issues privately through [GitHub Security Advisories](https://github.com/xilele777/snotes/security/advisories/new). Never post tokens or private note data in public issues.

## License

[MIT](LICENSE) © xilele777
