# Cloudflare deployment

[Documentation](README.md) · [中文](cloudflare-deployment.md)

## Version selection

The installation below pins stable release `v0.22.2`. Choose other tags from [Releases](https://github.com/xilele777/snotes/releases); `main` may contain unreleased changes. A pinned deployment uses detached HEAD. For upgrades, back up first, run `git fetch origin --tags`, then `git switch --detach <new-release-tag>`. Do not use `git pull` on detached HEAD or force a checkout over local settings.


You need one Worker, one D1 database, and one R2 bucket. Each product offers a free allowance; actual costs depend on usage. See [Free tier](#free-tier).

## 0. Prerequisites

- **Node.js 22.12 or newer** (wrangler 4 requires `>=22.0.0`, vite 8 requires `>=22.12.0`)
- **A Cloudflare account with R2 enabled**: go to Dashboard → R2 and follow the prompts. Step 2 fails if R2 hasn't been enabled.
- Log in to wrangler:

  ```bash
  npx wrangler login
  ```

## 1. Clone and install

```bash
git clone --branch v0.22.2 https://github.com/xilele777/snotes.git
cd snotes
npm ci
```

## 2. Create the D1 database and R2 bucket

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

## 3. Put your database_id into wrangler.jsonc (required)

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

## 4. Set the access token

This is the only credential protecting your notes. Use a random string, not a memorable password:

```bash
# Generate a 32-byte random token
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"

# Store it as a Worker secret (the command prompts you to paste it)
npx wrangler secret put ACCESS_TOKEN
```

`ACCESS_TOKEN` must be a secret — **never put it in the `vars` block of `wrangler.jsonc`**, which is plaintext config committed to the repo. Without it, data APIs return 401; the health check remains available.

## 5. Apply database migrations

```bash
npx wrangler d1 migrations apply snotes --remote
```

`--remote` targets the production database; `--local` only affects your local development database. The two are entirely separate.

## 6. Build and deploy

```bash
npm run deploy
```

This runs typecheck → vite build → wrangler deploy. On success you get a URL like `https://snotes.<your-subdomain>.workers.dev`.

Run an unauthenticated smoke check first:

```bash
curl https://snotes.<your-subdomain>.workers.dev/api/health
# expected: {"ok":true}
```

`/api/health` returns service status without exposing notes or tokens, for post-deploy verification.

## 7. First run

Open the Worker URL and paste the token from step 4. The token is stored locally in the browser, so you enter it once per device.

On mobile, use "Add to Home Screen" in Safari or Chrome to run it as a standalone PWA. On desktop Chrome or Edge, use the install button at the right of the address bar.

## 8. Updating to a new version

Manually deployed Workers do **not** update themselves when a release is published; pull the code and redeploy. At app startup, the app checks the latest stable GitHub Release and caches successful results for 24 hours. A blue dot on the "Settings" rail button indicates a newer release; the About tab in Settings links to release notes and shows upgrade steps. For release notifications, choose **Watch → Custom → Releases** on GitHub and enable email in your notification settings. The `git pull` instructions below apply to a tracked branch; pinned deployments should use the [tag upgrade steps](#version-selection) above.

Read the [CHANGELOG](../CHANGELOG.md), back up your data following the [operations guide](operations.md), enter the project directory and check `git status`. **If `wrangler.jsonc` has uncommitted deployment settings**, back it up outside the repository, then stash those changes:

```bash
git stash push -m "snotes deployment config" -- wrangler.jsonc
```

Only run this when there are config changes and confirm that Git created a stash. Save any other code changes too. If you previously enabled `skip-worktree`, run `git update-index --no-skip-worktree wrangler.jsonc` before checking status. That flag does not prevent upstream merge conflicts.

```bash
git pull --ff-only                                  # update the current branch
```

If you created the config stash above, run `git stash apply 'stash@{0}'` next (do not create another stash in between). Resolve any conflicts, preserving your Worker name, both database IDs and bucket names while incorporating upstream fields. Check the config before continuing. The stash remains as a backup until you choose to remove it after verification. Fork users must also sync the original project's changes into their branch; `git pull` only updates the current tracking branch.

```bash
npm ci                                              # install the locked dependencies
npx wrangler d1 migrations apply snotes --remote    # only does work when there are new migrations
npm run deploy                                      # build and deploy
```

Replace `snotes` in the migration command if you renamed the database. Secrets such as `ACCESS_TOKEN` stay on Cloudflare and do not need to be re-entered. After deployment, stay online while the browser downloads the new Service Worker and cache, then reload or close all app windows and reopen. Check the About tab in Settings to verify the new build; offline clients or clients still using the old cache do not update immediately.

## Optional: configure the usage-monitoring API

The `/api/metrics` endpoint and monitoring component are retained, but the sidebar entry is currently hidden. This setup is optional and does not affect notes or writing statistics. An unconfigured metrics endpoint returns 503 with `not_configured`.

Two secrets are needed:

```bash
npx wrangler secret put CF_ACCOUNT_ID   # Cloudflare account ID, in the Dashboard sidebar
npx wrangler secret put CF_API_TOKEN    # needs Account > Analytics > Read
```

For an existing Worker, `wrangler secret put` creates and immediately deploys a version containing the updated secret. Run `npm run deploy` as well if code changed. See the [Wrangler secret commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret).

To create the API token: Dashboard → My Profile → API Tokens → Create Token → Custom token, granting only **Account · Account Analytics · Read**. Don't grant anything broader.

## Renaming and custom domains

To use different names, edit the corresponding fields in `wrangler.jsonc` and keep them consistent with the resources you actually created:

| Field | Purpose | Matching command |
| --- | --- | --- |
| `name` | Worker name, determines `<name>.<subdomain>.workers.dev` | none needed |
| `d1_databases[].database_name` | D1 database name | `wrangler d1 create <name>` |
| `r2_buckets[].bucket_name` | R2 bucket name | `wrangler r2 bucket create <name>` |
| `vars.R2_BUCKET_NAME` | used by the monitoring page, must match the row above | — |

If you rename the database, update the migration command too: `wrangler d1 migrations apply <new-name> --remote`.

For a custom domain: Cloudflare Dashboard → Workers & Pages → select the Worker → Settings → Domains & Routes → Add Custom Domain. The domain must be on the same Cloudflare account.

## Deployment troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Deploy fails with `Couldn't find DB` or a D1 not-found error | The `database_id` from step 3 wasn't replaced, or only one of the two places was updated |
| `wrangler r2 bucket create` fails | R2 isn't enabled on the account — enable it under Dashboard → R2 |
| Migration can't find the database | Step 2 was skipped, or the database name in the command doesn't match `wrangler.jsonc` |
| The page keeps asking for the token | Check that the browser token matches the Worker's `ACCESS_TOKEN`; use `wrangler secret put ACCESS_TOKEN` to rotate it if needed |
| `/api/health` works but notes fail to load with 401 | Same cause; clear the token in the browser and re-enter it |
| Deploy succeeds but there's no workers.dev URL | The account's workers.dev subdomain is disabled — enable it under Workers & Pages → Settings, or attach a custom domain |
| Images broken, everything else fine | Bucket name doesn't match `wrangler.jsonc`, or the `snotes_token` cookie is missing — see the [operations guide](operations.md) |
| Monitoring page shows "not configured" | `CF_ACCOUNT_ID` / `CF_API_TOKEN` aren't set, or the token lacks Account Analytics Read |
| `stdin is not a tty` on Windows Git Bash | Run interactive commands like `wrangler secret put` from PowerShell or CMD, or prefix them with `winpty` |

## Free tier

Costs depend on requests, database reads and writes, image storage, and operations. The app is not guaranteed to be free for every workload. Check the current allowances and billing rules in the official documentation:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

Optional usage-monitoring calculations live in `worker/metrics/collect.ts` and need updating if platform policies change.
