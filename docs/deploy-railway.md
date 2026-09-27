# Deploying NBY AI Agents on Railway

This guide takes the app from this repository to a live, HTTPS site on [Railway](https://railway.com), with a PostgreSQL database, persistent file storage and working background jobs.

Expect about 30–45 minutes the first time.

---

## Contents

1. [How it runs on Railway](#1-how-it-runs-on-railway)
2. [What you need](#2-what-you-need)
3. [Files in this repo that Railway uses](#3-files-in-this-repo-that-railway-uses)
4. [Step 1 — Put the code on GitHub](#step-1--put-the-code-on-github)
5. [Step 2 — Create the Railway project and database](#step-2--create-the-railway-project-and-database)
6. [Step 3 — Add the app service](#step-3--add-the-app-service)
7. [Step 4 — Attach a volume for uploaded files](#step-4--attach-a-volume-for-uploaded-files)
8. [Step 5 — Set environment variables](#step-5--set-environment-variables)
9. [Step 6 — Give it a domain](#step-6--give-it-a-domain)
10. [Step 7 — Deploy and watch the first release](#step-7--deploy-and-watch-the-first-release)
11. [Step 8 — Create your account and make yourself platform admin](#step-8--create-your-account-and-make-yourself-platform-admin)
12. [Step 9 — Set up email (Resend)](#step-9--set-up-email-resend)
13. [Step 10 — Post-launch checklist](#step-10--post-launch-checklist)
14. [Updating the app](#updating-the-app)
15. [Backups and restore](#backups-and-restore)
16. [Costs and scaling](#costs-and-scaling)
17. [Troubleshooting](#troubleshooting)
18. [Environment variable reference](#environment-variable-reference)

---

## 1. How it runs on Railway

```
                 https://app.yourdomain.com
                            │
                   Railway edge (TLS, proxy)
                            │
          ┌─────────────────▼──────────────────┐
          │  App service  (npm start)          │
          │   • Next.js web server             │
          │   • embedded job worker            │──── volume /data  (uploaded files)
          │   • workflow scheduler clock       │
          └─────────────────┬──────────────────┘
                            │ private network
          ┌─────────────────▼──────────────────┐
          │  PostgreSQL service                │  (data + job queue)
          └────────────────────────────────────┘
```

- **One app service, one replica.** It runs the web server, the background worker and the scheduler in the same process (`instrumentation.ts`).
- **Why only one replica:** uploaded files live on a Railway volume, and a volume attaches to exactly one service instance.
  - Knowledge-base ingestion (a background job) reads those files, so the worker must run in the same service as the web server.
  - Keep `EMBEDDED_WORKER` unset (or `true`). Don't create a separate worker service.
- **Jobs need no Redis.** The job queue lives in PostgreSQL, so leave `REDIS_URL` empty.
- **Deploys cause a short outage.** Because of the volume, Railway stops the old instance before starting the new one. Expect a few seconds of downtime per deploy.

## 2. What you need

- A **GitHub** account. The repo will be pushed there, and Railway deploys from it.
- A **Railway** account.
  - **Hobby** is enough to launch and test with first customers.
  - Move to **Pro** when paying customers depend on the service. Pro has more storage, higher availability targets, longer logs and support.
- A **domain name** you control, e.g. `app.yourdomain.com`. Optional at first, because Railway gives you a free `*.up.railway.app` address.
- A **Resend** account for transactional email (verification, password reset, invites, approvals).
- API keys for at least one **AI provider** (Anthropic, OpenAI, Google or an OpenAI-compatible endpoint). Without one, agents run on the clearly labelled *Offline demo model*.
- **Node.js ≥ 20.9** on your own computer, only for generating secrets below.

## 3. Files in this repo that Railway uses

| File | What it does on Railway |
|---|---|
| `railway.json` | Records the intended service settings. Railway has deprecated config-as-code, and services created after 2026-08-28 ignore this file, so set the same values in the dashboard (Step 3). |
| `package.json` → `engines.node` | `>=20.9.0`. Railway's builder (Railpack) picks the Node version from this. |
| `package.json` → `build` | `prisma generate && next build`. Generates the database client and builds the app. |
| `prisma/migrations/` | The database schema, applied by `prisma migrate deploy` in the pre-deploy step. |
| `app/api/health/route.ts` | `GET /api/health`. Returns `200 {"status":"ok"}` when the app can reach the database, otherwise `503`. Railway only switches traffic to a new deploy once this passes. |
| `.env.example` | Documents every variable. Never upload your local `.env`; it is git-ignored. |

## Step 1 — Put the code on GitHub

The project is a local git repository with no remote yet.

1. On GitHub, create a new **private** repository, e.g. `nby-ai-agents`. Don't add a README or .gitignore, because the repo already has both.
2. Push the code. The work is on the `feat/nby-ai-agents-v1` branch. Railway deploys one branch, so either merge it into `master`/`main` first or deploy that branch directly.

```bash
git remote add origin https://github.com/<you>/nby-ai-agents.git
```

```bash
git push -u origin feat/nby-ai-agents-v1
```

3. Check on GitHub that **`.env` and `.data/` are not in the repository.** They are git-ignored, but confirm anyway, since `.env` holds your local secrets.

## Step 2 — Create the Railway project and database

1. In Railway, click **New Project → Deploy PostgreSQL**. This creates a project containing a **Postgres** service.
2. Wait for it to become healthy. Its **Variables** tab now contains, among others:
   - `DATABASE_URL`: the private-network address, used by the app.
   - `DATABASE_PUBLIC_URL`: reachable from your computer, used for backups and admin tasks.

> If you'd rather use an external PostgreSQL (Neon, Supabase, etc.), skip this step and paste that provider's connection string as `DATABASE_URL` in Step 5. It must be PostgreSQL 14+ and should require SSL (`?sslmode=require`).

## Step 3 — Add the app service

1. In the same project, click **Create → GitHub Repo**. Authorise Railway to read your GitHub account if asked, then pick `nby-ai-agents`.
2. Open the new service → **Settings**:
   - **Source → Branch:** choose the branch you pushed (e.g. `feat/nby-ai-agents-v1`, or `main` after merging).
   - **Build:** leave the builder on **Railpack** and the build command empty. Railpack runs `npm run build` by default.
   - **Deploy → Pre-deploy step:** set it to `npm run db:deploy`, which runs database migrations before each release.
   - **Deploy → Start command:** leave it empty. Railpack runs `npm start` by default.
   - **Deploy → Healthcheck Path:** set it to `/api/health`.
   - **Deploy → Serverless:** keep it **off**. If the app sleeps, the job worker and scheduler stop.
   - Rename the service to something like `web`. This is optional.
3. Railway will try to deploy immediately. **That first deploy fails** because no environment variables exist yet. That's expected; continue.

## Step 4 — Attach a volume for uploaded files

Uploaded knowledge files, workflow attachments and generated exports are stored on disk. Without a volume they disappear on every deploy.

1. Right-click the app service (or use **Create → Volume**) and attach a new **Volume** to it.
2. Set **Mount path** to `/data`.
3. In Step 5 you'll point the app at it with `STORAGE_LOCAL_DIR=/data/storage`. The app creates the folder itself.

## Step 5 — Set environment variables

### 5a. Generate the secrets on your own computer

Run this twice, once for each secret. Keep the output private.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- The first output is your `ENCRYPTION_KEY`.
- The second is your `SIGNING_SECRET`.

> ⚠️ **Store `ENCRYPTION_KEY` in a password manager now.** It encrypts saved integration credentials and secrets in the database.
> - If you lose it or change it, every stored credential becomes unreadable and must be re-entered.
> - Never reuse your local development key.

### 5b. Add them to the app service

Open the app service → **Variables** → **Raw Editor**, paste the following, then fill in the values:

```bash
# Where the app is reachable. Must be the exact public https address (no trailing slash).
# Use the *.up.railway.app address from Step 6 for now; change it when you add your domain.
APP_URL="https://your-app.up.railway.app"

# Database: a reference to the Postgres service's private URL (keep the ${{ }} syntax).
DATABASE_URL="${{Postgres.DATABASE_URL}}"

# Security
ENCRYPTION_KEY="<first generated value>"
SIGNING_SECRET="<second generated value>"
TRUSTED_PROXY_HOPS="1"

# Storage on the volume from Step 4
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="/data/storage"

# Email (see Step 9; "console" only logs messages and delivers nothing)
EMAIL_PROVIDER="resend"
RESEND_API_KEY="<your Resend API key>"
EMAIL_FROM="NBY AI Agents <no-reply@yourdomain.com>"

# AI providers: set at least one; leave the others out
ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
GOOGLE_API_KEY=""
```

Notes:

- `${{Postgres.DATABASE_URL}}` is a Railway **reference variable**. If you renamed the database service, use its name instead of `Postgres`.
- **Don't set these on Railway:**
  - `NODE_ENV`: `npm start` runs in production mode by itself.
  - `PORT`: Railway sets it, and `next start` listens on it.
  - `EMBEDDED_WORKER`: it must stay on; see section 1.
  - `REDIS_URL`
  - `ALLOW_PRIVATE_NETWORK_TOOLS`
  - `RATE_LIMIT_SCALE`
  - `EMAIL_FILE_DIR`
  - `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`
- If one of the required variables is missing or malformed, the app refuses to start and lists which one in the deploy logs.

Click **Deploy** (or **Apply changes**) to save.

## Step 6 — Give it a domain

1. Open the app service → **Settings → Networking**.
2. Click **Generate Domain**, enter port `8080` (the `PORT` Railway gives the app), and you get `https://<name>.up.railway.app`. Put this exact address in `APP_URL` if you haven't already.
3. **Custom domain** (recommended before real users sign up):
   1. Click **Custom Domain** and enter e.g. `app.yourdomain.com`.
   2. Railway shows a **CNAME** record (and possibly a TXT record for verification). Add them at your DNS provider.
   3. Wait until Railway shows the domain as verified. It issues the TLS certificate automatically.
   4. Change `APP_URL` to `https://app.yourdomain.com` and redeploy.

> `APP_URL` matters more than it looks. The app uses it in:
> - email links (verification, password reset, invites)
> - public webhook URLs shown in the workflow builder
> - signed download links
> - the `Secure` flag on session cookies
>
> Always keep it equal to the address people actually use.

## Step 7 — Deploy and watch the first release

1. Open the app service → **Deployments** and trigger a deploy (or push a commit).
2. Watch the phases in the logs:
   - **Build:** `npm ci`, then `prisma generate`, then `next build`. This takes a few minutes.
   - **Pre-deploy:** `prisma migrate deploy` creates all tables on the first run. On later runs it applies only new migrations.
     - If this step fails, the new version is **not** released and the old one keeps running.
   - **Deploy:** `next start`, then the health check at `/api/health`. Once it returns 200, traffic moves to the new version.
3. Open `https://<your address>/api/health`. It should show `{"status":"ok"}`.
4. Open the home page and the sign-in page.

## Step 8 — Create your account and make yourself platform admin

The production database starts empty. There's no demo data and no demo admin: `npm run demo:admin` and the seed are for local development only.

1. Go to `https://<your address>/signup` and create your account. Verify the email (this needs Step 9 working), then finish onboarding to create your company.
2. Promote yourself to **platform admin**, which opens `/admin` for managing organizations, users, usage and health. Run this SQL once against the production database:

   ```sql
   UPDATE "User" SET "platformRole" = 'SUPER_ADMIN' WHERE email = 'you@yourdomain.com';
   ```

   There are two ways to run it:
   - **Railway dashboard:** open the Postgres service → **Database** tab and run the query there.
   - **Railway CLI:** requires `psql` installed locally.

     ```bash
     npm i -g @railway/cli
     ```

     ```bash
     railway login
     ```

     ```bash
     railway link
     ```

     ```bash
     railway connect Postgres
     ```

3. Sign out and back in, then open `/admin`.

> Only promote people you fully trust. Platform admins can see and suspend every organization.

## Step 9 — Set up email (Resend)

1. In Resend, add and **verify your sending domain**. Resend gives you DNS records (SPF/DKIM) to add at your DNS provider.
2. Create an API key and set it as `RESEND_API_KEY`.
3. Set `EMAIL_FROM` to an address on that verified domain, e.g. `NBY AI Agents <no-reply@yourdomain.com>`.
4. Redeploy, then test with **Forgot password** on your own account.

Email failures never break the request that triggered them. They're logged as `[email] send failed` in the app logs.

> SMTP (e.g. a cPanel mailbox) is not supported. The providers are `resend` and `console` (logs only). `file` works only on localhost.

## Step 10 — Post-launch checklist

- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] Sign up, email verification and password reset emails arrive
- [ ] You can open `/admin`
- [ ] **Knowledge:** upload a document, wait until it shows as processed, then **redeploy** and confirm the file is still there. This proves the volume works.
- [ ] **AI:** give an AI employee a task. The run should show your real model, not "Offline demo model", if you set an AI key.
- [ ] **Scheduler:** create a workflow with a schedule trigger a few minutes ahead and confirm it runs. This proves the embedded worker and scheduler are alive.
- [ ] **Webhooks:** in the workflow builder, check that the public webhook URL uses your real domain
- [ ] The service's sleeping setting is **off** (Settings → Deploy → Serverless)
- [ ] Backups are in place (see below)
- [ ] `ENCRYPTION_KEY` is saved in a password manager
- [ ] Usage alerts or a spending limit are set in Railway's billing settings

## Updating the app

1. Commit and push to the deployed branch. Railway builds and deploys automatically.
2. For each deploy:
   - New database migrations run in the pre-deploy step.
   - If a migration fails, the release stops and the old version stays live. Fix the migration and push again.
3. **Rolling back:** use **Deployments → ⋯ → Rollback** on an earlier deployment.
   - Rollback only swaps the code. It does **not** undo database migrations.
   - Keep migrations backward-compatible (add columns and tables first, remove them in a later release).
4. **Schema changes** go through the normal local flow:
   1. Create the migration with `npm run db:migrate` locally.
   2. Commit `prisma/migrations/...`.
   3. Push. Railway applies it.

## Backups and restore

There are two things to protect: the **database** and the **volume** (uploaded files).

1. **Railway backups.**
   - If your plan offers backups for the Postgres service and the app volume, turn on scheduled backups for **both**.
   - Check that a backup exists before relying on it.
2. **Your own database dump** (recommended as a second copy).
   1. Copy `DATABASE_PUBLIC_URL` from the Postgres service's Variables tab.
   2. Run the following from any machine with PostgreSQL client tools, and store the file somewhere safe (it contains all customer data):

   ```bash
   pg_dump "<DATABASE_PUBLIC_URL>" --format=custom --file=nby-backup.dump
   ```

   To restore into an empty database:

   ```bash
   pg_restore --no-owner --dbname="<DATABASE_PUBLIC_URL>" nby-backup.dump
   ```

3. **Encryption key.**
   - A database backup is useless for integration credentials without the matching `ENCRYPTION_KEY`.
   - Back up the key separately, and never alongside the dump.

## Costs and scaling

- Railway bills for the **resources you actually use** (memory, CPU, volume storage, network). The plan price is a minimum that includes the same amount of usage credit.
  - This setup runs two services around the clock: the app and Postgres.
  - Check **Usage** after the first week rather than guessing.
- **Hobby's storage limit** is usually the first one you'll hit, because it covers the database and uploaded files together.
- **To scale up:** raise the service's CPU/RAM limits.
  - Replicas aren't possible with the local-disk volume.
  - Horizontal scaling would need an object-storage driver in `lib/storage` (S3, R2, etc.) and a dedicated worker service. That's a code change, not a setting.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Build fails with `Cannot find module` for `@tailwindcss/postcss`, `typescript` or `tailwindcss` | Dev dependencies were skipped during install. Make sure you did **not** set `NODE_ENV=production` or `NPM_CONFIG_PRODUCTION=true` as service variables. If it persists, add `NPM_CONFIG_PRODUCTION=false`. |
| Build or startup says the Node version is too old | `engines.node` in `package.json` requires ≥ 20.9. Check that the build log shows Node 20.9+ or 22. You can force a version with the variable `RAILPACK_NODE_VERSION=22`. |
| Deploy log: `Invalid environment configuration` | The listed variable is missing or malformed.<br>• `ENCRYPTION_KEY` must be base64 of exactly 32 bytes (use the command in Step 5a).<br>• `SIGNING_SECRET` must be at least 16 characters. |
| Pre-deploy fails with `P1001` / can't reach database | `DATABASE_URL` is wrong, or the Postgres service is down or has a different name. Use `${{<ServiceName>.DATABASE_URL}}`. |
| Health check never passes | Open the deploy logs.<br>• A startup error (usually environment) appears first.<br>• `/api/health` returning 503 means the database is unreachable. |
| Sign-in "works" but you land back on the login page | `APP_URL` doesn't match the address in the browser (http vs https, or the old `*.up.railway.app` address after adding a custom domain). Fix `APP_URL` and redeploy. |
| Emails never arrive | Check each of these:<br>• `EMAIL_PROVIDER` is `resend` and `RESEND_API_KEY` is set.<br>• The `EMAIL_FROM` domain is verified in Resend.<br>• The app logs don't show `[email] send failed`. |
| Uploaded files vanish after a deploy | The volume isn't attached at `/data`, or `STORAGE_LOCAL_DIR` isn't `/data/storage`. |
| `EACCES: permission denied` under `/data` | The container user can't write to the volume. Add the variable `RAILWAY_RUN_UID=0` and redeploy. |
| Tasks sit in "queued" or schedules don't fire | Check each of these:<br>• `EMBEDDED_WORKER` isn't set to `false`.<br>• Sleeping isn't enabled on the service.<br>• The deploy logs show no worker errors at startup. |
| Everyone seems to share one rate limit (e.g. sign-in "too many attempts" for unrelated users) | `TRUSTED_PROXY_HOPS` doesn't match the proxy chain. Use `1` with Railway's edge alone. If you add another proxy that appends `X-Forwarded-For` (e.g. Cloudflare in proxied mode), use `2`. |
| Agents answer as "Offline demo model" | No AI provider key is set, or the key is invalid. Add one and redeploy. |
| `OPENAI_COMPATIBLE_BASE_URL` requests blocked | For SSRF protection, the endpoint must resolve to a public address. Private or internal addresses are rejected. |

Logs are in each service's **Deployments → View logs**, or on the command line:

```bash
railway logs
```

## Environment variable reference

| Variable | Required | Value on Railway |
|---|---|---|
| `APP_URL` | ✅ | Exact public https URL, no trailing slash |
| `DATABASE_URL` | ✅ | `${{Postgres.DATABASE_URL}}` |
| `ENCRYPTION_KEY` | ✅ | 32 random bytes, base64. **Never change it after launch.** |
| `SIGNING_SECRET` | ✅ | Random, at least 16 characters |
| `TRUSTED_PROXY_HOPS` | ✅ | `1` |
| `STORAGE_DRIVER` | ✅ | `local` |
| `STORAGE_LOCAL_DIR` | ✅ | `/data/storage` (on the volume) |
| `EMAIL_PROVIDER` | ✅ | `resend` |
| `RESEND_API_KEY` | ✅ | From Resend |
| `EMAIL_FROM` | ✅ | Address on your verified domain |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` | at least one | Provider keys |
| `OPENAI_COMPATIBLE_BASE_URL` / `OPENAI_COMPATIBLE_API_KEY` | optional | Public OpenAI-compatible endpoint |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, `HUBSPOT_OAUTH_CLIENT_ID` / `_SECRET` | optional | Integrations show "Not configured" until set |
| `WORKER_CONCURRENCY` | optional | Background jobs run in parallel (default `3`) |
| `PORT` | — | Set by Railway; don't override |
| `NODE_ENV`, `EMBEDDED_WORKER`, `REDIS_URL`, `ALLOW_PRIVATE_NETWORK_TOOLS`, `RATE_LIMIT_SCALE`, `EMAIL_FILE_DIR`, `DEMO_ADMIN_*` | ✖ | Don't set these in production |
