# snotes

A local-first personal Markdown notepad that runs entirely within Cloudflare's free tier.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

[中文](README.md) | English

Every write lands in the browser's IndexedDB first, so the UI never waits on the network and works fully offline. A background Worker handles incremental sync and image storage. Self-host it with a single Cloudflare account — no third-party services involved.

## Features

- **Offline first** — all reads and writes hit IndexedDB, fully usable offline, syncs incrementally once reconnected
- **Plain Markdown** — your content is never locked into a proprietary format; export is plain text
- **Incremental sync** — a version manifest goes first, so starring or pinning a note never re-uploads its body
- **Direct image upload** — paste to upload to R2; `<img>` is authenticated by a same-origin cookie and stays viewable offline
- **PWA** — installable to desktop or mobile home screen; on mobile it opens straight to the list, and the system back button exits cleanly
- **Single Worker** — frontend and API share one origin, no CORS, static assets and API served by the same process
- **Conflict copies** — when two devices edit the same note offline, the overwritten version is saved as a copy instead of being lost
- **Usage monitoring** — tracks D1, R2 and Workers consumption against free-tier limits on the official billing cycles

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | Vue 3, Pinia, Milkdown (Markdown editor), Dexie (IndexedDB) |
| PWA | vite-plugin-pwa (Workbox) |
| Backend | Cloudflare Workers, Hono |
| Storage | Cloudflare D1 (metadata/body), R2 (images) |
| Testing | Vitest (unit/integration), Playwright (end-to-end) |

## Architecture

```
Browser
  ┌──────────────────────────────────────────────┐
  │ Vue SPA (Milkdown editor)                    │
  │ IndexedDB ←→ local-first reads/writes (Dexie)│
  │ Outbox queue → background incremental push   │
  └───────────────────┬──────────────────────────┘
                      │ same-origin fetch (Bearer / Cookie)
                      ▼
        A single Cloudflare Worker
        ┌──────────────────────────────────┐
        │ Static assets (dist) + Hono API  │
        │   /api/notes    /api/sync/*      │
        │   /api/groups   /api/trash/*     │
        │   /api/images/* /api/metrics/*   │
        └──────┬─────────────────────┬─────┘
               ▼                     ▼
            D1 (notes)            R2 (images)
```

- Every API call is authenticated with `Authorization: Bearer <token>`. The one exception is `<img>`, which falls back to a same-origin cookie scoped to `Path=/api/images/`
- The sync engine lives in `src/sync/`: `pull` fetches the version manifest and missing bodies, `push` drains the outbox queue, `conflict` handles concurrent-edit copies
- Database schema is in `migrations/`; types shared between frontend and Worker are in `shared/types.ts`

## Deploy to your own Cloudflare account

The whole app is one Worker plus two storage resources (D1 + R2), all within the free tier.

### 0. Prerequisites

- **Node.js 22.12 or newer** (wrangler 4 requires `>=22.0.0`, vite 8 requires `>=22.12.0`)
- **A Cloudflare account with R2 enabled**: go to Dashboard → R2 and follow the prompts. Step 2 fails if R2 hasn't been enabled.
- Log in to wrangler:

  ```bash
  npx wrangler login
  ```

### 1. Clone and install

```bash
git clone https://github.com/xilele777/snotes.git
cd snotes
npm install
```

### 2. Create the D1 database and R2 bucket

```bash
npx wrangler d1 create snotes
npx wrangler r2 bucket create snotes-images
```

The first command prints a config snippet containing **your own** `database_id`, which you need in the next step:

```
[[d1_databases]]
binding = "DB"
database_name = "snotes"
database_id = "your-database-uuid"
```

> Want different names? See [Renaming and custom domains](#renaming-and-custom-domains). Keeping the defaults is the easiest path.

### 3. Put your database_id into wrangler.jsonc (required)

The repository ships with the original author's database ID. **Deployment will fail unless you replace it** — in **two places**:

```diff
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "snotes",
-      "database_id": "66325ab4-c335-4976-9a62-b0c9e5e21e97",
+      "database_id": "your uuid from step 2",
       "migrations_dir": "migrations"
     }
   ],
   ...
   "vars": {
-    "D1_DATABASE_ID": "66325ab4-c335-4976-9a62-b0c9e5e21e97",
+    "D1_DATABASE_ID": "the same uuid",
     "R2_BUCKET_NAME": "snotes-images"
   }
```

Same value, different purposes: `d1_databases[].database_id` is the runtime database binding — the app won't start without it. `vars.D1_DATABASE_ID` is only used by the usage-monitoring page to query Analytics; getting it wrong won't break note-taking, but the monitoring page won't show D1 data. Neither these IDs nor the bucket name are secrets, so committing them is fine.

### 4. Set the access token

This is the only credential protecting your notes. Use a random string, not a memorable password:

```bash
# Generate a 32-byte random token
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"

# Store it as a Worker secret (the command prompts you to paste it)
npx wrangler secret put ACCESS_TOKEN
```

`ACCESS_TOKEN` must be a secret — **never put it in the `vars` block of `wrangler.jsonc`**, which is plaintext config committed to the repo. When it isn't set, every API endpoint returns 401.

### 5. Apply database migrations

```bash
npx wrangler d1 migrations apply snotes --remote
```

`--remote` targets the production database; `--local` only affects your local development database. The two are entirely separate.

### 6. Build and deploy

```bash
npm run deploy
```

This runs typecheck → vite build → wrangler deploy. On success you get a URL like `https://snotes.<your-subdomain>.workers.dev`.

Run an unauthenticated smoke check first:

```bash
curl https://snotes.<your-subdomain>.workers.dev/api/health
# expected: {"ok":true}
```

`/api/health` is registered before the auth middleware and returns no data — it exists purely for post-deploy verification.

### 7. First run

Open the Worker URL and paste the token from step 4. The token is stored locally in the browser, so you enter it once per device.

On mobile, use "Add to Home Screen" in Safari or Chrome to run it as a standalone PWA. On desktop Chrome or Edge, use the install button at the right of the address bar.

### Optional: enable the usage-monitoring page

Skipping this doesn't affect note-taking — `/api/metrics` returns 503 with `not_configured` and the page shows as unconfigured.

Two secrets are needed:

```bash
npx wrangler secret put CF_ACCOUNT_ID   # Cloudflare account ID, in the Dashboard sidebar
npx wrangler secret put CF_API_TOKEN    # needs Account > Analytics > Read
npm run deploy                          # redeploy for secret changes to take effect
```

To create the API token: Dashboard → My Profile → API Tokens → Create Token → Custom token, granting only **Account · Account Analytics · Read**. Don't grant anything broader.

### Renaming and custom domains

To use different names, edit the corresponding fields in `wrangler.jsonc` and keep them consistent with the resources you actually created:

| Field | Purpose | Matching command |
| --- | --- | --- |
| `name` | Worker name, determines `<name>.<subdomain>.workers.dev` | none needed |
| `d1_databases[].database_name` | D1 database name | `wrangler d1 create <name>` |
| `r2_buckets[].bucket_name` | R2 bucket name | `wrangler r2 bucket create <name>` |
| `vars.R2_BUCKET_NAME` | used by the monitoring page, must match the row above | — |

If you rename the database, update the migration command too: `wrangler d1 migrations apply <new-name> --remote`.

For a custom domain: Cloudflare Dashboard → Workers & Pages → select the Worker → Settings → Domains & Routes → Add Custom Domain. The domain must be on the same Cloudflare account.

### Deployment troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Deploy fails with `Couldn't find DB` or a D1 not-found error | The `database_id` from step 3 wasn't replaced, or only one of the two places was updated |
| `wrangler r2 bucket create` fails | R2 isn't enabled on the account — enable it under Dashboard → R2 |
| Migration can't find the database | Step 2 was skipped, or the database name in the command doesn't match `wrangler.jsonc` |
| The page keeps asking for the token | Token mismatch. After `wrangler secret put ACCESS_TOKEN` you **must** run `npm run deploy` again |
| `/api/health` works but notes fail to load with 401 | Same cause; clear the token in the browser and re-enter it |
| Deploy succeeds but there's no workers.dev URL | The account's workers.dev subdomain is disabled — enable it under Workers & Pages → Settings, or attach a custom domain |
| Images broken, everything else fine | Bucket name doesn't match `wrangler.jsonc`, or the `snotes_token` cookie is missing — see the [operations guide](docs/operations.md) |
| Monitoring page shows "not configured" | `CF_ACCOUNT_ID` / `CF_API_TOKEN` aren't set, or the token lacks Account Analytics Read |
| `stdin is not a tty` on Windows Git Bash | Run interactive commands like `wrangler secret put` from PowerShell or CMD, or prefix them with `winpty` |

## Local development

```bash
npm install

# The token is required: without it the Worker returns 401 for every API call
echo "ACCESS_TOKEN=dev-token" > .dev.vars

# Initialise the local database (separate from production)
npx wrangler d1 migrations apply snotes --local

npm run dev:worker   # terminal 1: Worker on 8787
npm run dev          # terminal 2: frontend on 5173
```

Open <http://localhost:5173> and enter `dev-token`. The frontend reaches the API on 8787 through the vite proxy, matching the same-origin shape of production. `.dev.vars` is gitignored.

Local development doesn't need real D1/R2 resources — wrangler simulates them locally, so you can do this before touching `database_id`.

### Testing

```bash
npm test            # frontend and shared pure logic
npm run test:worker # Worker integration tests (in the real Workers runtime)
npm run test:all    # both of the above
npm run test:e2e    # Playwright end-to-end
npm run typecheck   # type checking
```

The E2E suite runs `npm run build` and starts `wrangler dev` on its own, testing the production shape (same-origin static assets + API). No need to start anything first.

> **Behind a proxy**: run `unset HTTP_PROXY HTTPS_PROXY` before the E2E suite. workerd crashes on proxy environment variables, which shows up as tests hanging indefinitely.

Please make sure `npm run test:all && npm run build` passes before committing.

## Free tier

Single-user usage stays far below every limit. The in-app usage page compares consumption against the numbers below on the official billing cycles (defined in `worker/metrics/collect.ts` — update that one place if Cloudflare's policy changes):

| Resource | Free tier | Period |
| --- | --- | --- |
| D1 rows read | 5,000,000 | per day |
| D1 rows written | 100,000 | per day |
| Workers requests | 100,000 | per day |
| R2 Class A operations (write) | 1,000,000 | calendar month |
| R2 Class B operations (read) | 10,000,000 | calendar month |
| R2 storage | 10 GB | current snapshot |

The page flags anything at or above 80% as approaching the limit; only past 100% counts as exceeded.

## Backup and migration

```bash
# Export (a manual run each month is enough)
npx wrangler d1 export snotes --remote --output "backup-$(date +%Y%m).sql"

# Restore
npx wrangler d1 execute snotes --remote --file backup-YYYYMM.sql
```

Note bodies and metadata both live in D1, so the exported SQL is a complete backup. Images live in R2, which is already redundant, and don't need separate backups.

## Project structure

```
src/            frontend (Vue 3 + Pinia)
  components/    list, detail, sidebar, monitoring components
  editor/        Milkdown editor wrapper
  stores/        Pinia state (notes / ui / groups)
  sync/          sync engine (pull / push / conflict)
  db/            Dexie schema and repos
  api/           client for talking to the Worker
  navigation.ts  mobile History navigation stack
worker/         Cloudflare Worker (Hono API)
  routes/        notes / opens / groups / sync / trash / images / metrics
  metrics/       D1/R2/HTTP metrics collection
  auth.ts        Bearer + cookie auth middleware
shared/         types and logic shared by both sides (sync reduce, sorting, sanitising)
migrations/     D1 database migrations
tests/          e2e, Worker integration, unit tests and setup
docs/           design documents, operations guide
```

## Documentation

- [Design document](docs/superpowers/specs/2026-08-22-snotes-design.md) (Chinese)
- [Implementation plan](docs/superpowers/plans/2026-08-22-snotes.md) (Chinese)
- [Operations guide](docs/operations.md) (Chinese) — token mechanics, sync failure triage, backups, FAQ
- [Changelog](CHANGELOG.md)

## Security

This is a **single-user, self-hosted** application. Authentication is one shared token — use it with that in mind:

- Anyone holding the `ACCESS_TOKEN` can read and write all your notes and images. There are no multiple users, sharing, or permission levels
- The token is kept in the browser's `localStorage`, plus a cookie scoped to `Path=/api/images/` that exists solely for `<img>` requests
- If the token leaks, run `wrangler secret put ACCESS_TOKEN` and redeploy to invalidate the old one. All clients get a 401 and return to the token entry screen; local data is unaffected
- Never commit the token to `wrangler.jsonc`, `.env`, or any file that reaches the repository

Please report security issues privately via GitHub [Security Advisories](https://github.com/xilele777/snotes/security/advisories/new) rather than opening a public issue.

## Contributing

Issues and pull requests are welcome. Before submitting:

- Make sure `npm run test:all && npm run build` passes
- Follow [Conventional Commits](https://www.conventionalcommits.org/) — see [CLAUDE.md](CLAUDE.md) for the exact format
- Schema changes always go into a new incrementing `migrations/000N_*.sql`; never edit an existing migration. Migration numbers are a separate sequence from the app version
- The single source of truth for the version is the `version` field in the root `package.json`; the release process is in [CLAUDE.md](CLAUDE.md)
- Behaviour changes should come with tests

## License

[MIT](LICENSE) © xilele777
