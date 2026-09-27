# NBY AI Agents

Build an AI workforce: hire AI employees, give them company knowledge and tools, decide exactly what they may do, and automate real work with workflows — with humans approving anything that matters.

Everything shown in the product is real or clearly labelled: simulated integrations say "Simulated", test runs say "Simulation", the offline model says it isn't AI, and demo workspaces carry a "Demo data" badge. Metrics are measured, never invented.

---

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Environment setup](#environment-setup)
- [Database, migrations and seed](#database-migrations-and-seed)
- [AI providers](#ai-providers)
- [Integrations and tools](#integrations-and-tools)
- [Queues and background work](#queues-and-background-work)
- [Workflow engine](#workflow-engine)
- [Public API and webhooks](#public-api-and-webhooks)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## Overview

| Area | What it does |
| --- | --- |
| **AI employees** | Role, instructions, personality, model, knowledge, tools and per-tool permissions (allowed / requires approval / denied). Draft → publish with immutable versions. Chat, tasks, memory, delegation. |
| **Knowledge** | Upload PDF, DOCX, XLSX, CSV, Markdown, text or web pages. Extraction, chunking, embeddings and hybrid search with citations. Per-collection access. |
| **Tools & integrations** | Built-in simulated integrations (Mock CRM, Email, Calendar, Search, Sheets, Store), custom REST tools with an SSRF-safe client, encrypted credentials. |
| **Permissions & policies** | Company and department policies, approval rules (e.g. *email to external recipient ⇒ approval*), enforced on the server for every tool call. |
| **Approvals & inbox** | Approve, edit-then-approve or reject actions; answer questions and escalations; take over a task. Paused work resumes automatically. |
| **Workflows** | Visual builder (React Flow), generator from plain language, templates, validation, simulation, publish, runs with retries, loops, branches, human steps, schedules, events and webhooks. |
| **Dashboard, AI Office, analytics** | Command center, a visual map of the workforce, and measured analytics (executions, success, duration, tokens, estimated cost, errors). |
| **Platform admin** | Organizations, users, usage vs. plan entitlements, errors, system health, and platform-wide integration/template switches. |

## Architecture

- **Next.js 16 (App Router)** with server components, server actions and route handlers. Note: Next 16 uses `proxy.ts` (not middleware) and async `params`/`searchParams`. See `AGENTS.md`.
- **TypeScript**, **Tailwind CSS v4**, **shadcn/ui**, **React Flow**, **Recharts**, **Framer Motion**.
- **Prisma 7 + PostgreSQL**. The Prisma client is generated into `lib/generated/prisma`. IDs are prefixed (`agent_…`, `wf_…`) via a SQL function.
- **Jobs**: a durable PostgreSQL queue (`FOR UPDATE SKIP LOCKED`), or BullMQ when `REDIS_URL` is set.

```
app/            Routes: (auth), (app) workspace, onboarding, admin, api (v1, webhooks, files)
components/     UI: layout shell, dashboard, office, workflows, approvals, agents, …
lib/            Pure logic: ai (providers, router), permissions, policies, workflows (types,
                expressions, validation), security (crypto, SSRF, rate limits), templates
server/         Services (one per domain), runtime (agent loop, context building),
                workflows (engine, scheduler, events), tools (executor), jobs (queue, handlers)
prisma/         Schema, migrations, seed
tests/          unit/, integration/ (Vitest, real Postgres), e2e/ (Playwright)
```

Key flows:

- **Agent runtime** (`server/runtime/agent-runtime.ts`): a persisted state machine. Each step is recorded; tool calls go through the permission engine; approvals pause the run and a job resumes it. Limits (steps, tool calls, tokens, cost, time) and budgets are enforced.
- **Permission engine** (`lib/permissions/engine.ts`): system → tool → company/department/employee policies → employee grant → risk → approval rules. The most restrictive outcome wins.
- **Workflow engine** (`server/workflows/engine.ts`): graph execution with leases, dead-path elimination, retries, loops, human steps and idempotent tool steps.

## Environment setup

Requirements: **Node.js 20+** and **PostgreSQL 14+** (or the bundled embedded Postgres for local development).

```bash
npm install
cp .env.example .env         # then fill in ENCRYPTION_KEY and SIGNING_SECRET
npm run db:start             # embedded Postgres on :5433 (creates nby and nby_test) — keep it running
npm run db:deploy            # apply migrations
npm run db:seed              # optional: NBY Demo Company + demo admin
npm run dev                  # http://localhost:3000
```

Generate the secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`npm run demo:admin` creates or resets a local demo admin (`DEMO_ADMIN_EMAIL`). If `DEMO_ADMIN_PASSWORD` is empty, a password is generated into your `.env`. The demo admin is also a platform admin (`/admin`).

## Database, migrations and seed

- Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/*` (hand-written SQL where needed).
- Apply: `npm run db:deploy`. Regenerate the client: `npm run db:generate`.
- Check for drift: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.
- **Seed** (`npm run db:seed`) builds *NBY Demo Company* (flagged as demo):
  - Departments, the simulated integrations, a Company Handbook, 8 employees from templates, and 4 workflows that are genuinely simulated and then published.
  - Real pending work (employees pause on real approvals and input requests).
  - Bulk demo history (tasks, runs, usage) for the dashboard. Every bulk row is tagged; `npm run db:seed -- --reset` removes and rebuilds exactly those rows.

## AI providers

Set any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, or an OpenAI-compatible endpoint. Companies can also add their own keys (encrypted) in **Settings → AI providers**.

- Defaults: `claude-opus-5` (Anthropic), `gpt-4.1` (OpenAI), `gemini-2.5-pro` (Google).
- The model router retries and falls back between providers.
- Without keys, employees use the **Offline demo model**. It is deterministic, retrieves knowledge and follows simple tool rules, and it says clearly that it isn't AI. The generators then fall back to template matching and say so.

## Integrations and tools

- **Simulated integrations** (`lib/integrations/mock`) store records inside NBY only. Sending an email records it in a mock outbox and never delivers it.
- **Custom REST tools**: build them in the UI with typed parameters, auth (bearer, API key, basic) and encrypted credentials. Requests go through `safeHttpRequest`:
  - http/https only;
  - private, loopback and metadata ranges blocked, checked at connect time;
  - redirects are re-validated and never forward credentials across origins;
  - size and time limits.
- OAuth providers (Google, HubSpot, …) appear as "Not configured" until their client IDs are set.
- Platform admins can switch any integration off for everyone (`/admin/catalog`).

## Queues and background work

Jobs: `agent.execute`, `agent.resume`, `workflow.advance`, `knowledge.index`, `schedules.tick`, `maintenance.cleanup`.

- By default the web server runs an embedded worker (`instrumentation.ts`).
- In production, set `EMBEDDED_WORKER=false` and run `npm run worker` as a separate process (scale it horizontally).
- With `REDIS_URL` set, BullMQ is used; otherwise the PostgreSQL queue.
- `/admin/health` shows the backlog, stuck jobs, failed jobs and whether a worker is picking jobs up.

## Workflow engine

- Drafts are edited, validated and **simulated** (no side effects; approvals assumed). Only a successfully simulated draft can be **published**.
- Live runs use the published version.
- Steps:
  - Triggers: manual, schedule, webhook, API, event.
  - AI steps and employee steps.
  - Tools, conditions, switch, filter, loop, merge and delay.
  - Human approval, review and input.
- Variables use `{{trigger.x}}`, `{{nodes.key.field}}` and `{{company.name}}`. Values substituted into AI prompts are wrapped as untrusted data.
- Retries follow the step's policy. Tool steps are idempotent (`runId:nodeKey`), so an email is never sent twice.
- Create workflows by describing them (`/workflows/new?mode=describe`), from templates (`/templates`), or on a blank canvas.

## Public API and webhooks

Create scoped keys in **Settings → API keys**. A key is shown once; only a SHA-256 hash is stored. Each key is limited to 120 requests per minute.

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/api/v1/agents` | `agents:read` |
| POST | `/api/v1/agents/{agentId}/run` | `agents:run` |
| GET | `/api/v1/tasks/{taskId}` | `tasks:read` |
| GET | `/api/v1/workflows` | `workflows:read` |
| POST | `/api/v1/workflows/{workflowId}/run` | `workflows:run` |
| GET | `/api/v1/workflow-runs/{runId}` | `workflows:read` |
| POST | `/api/webhooks/{key}` | signature **or** `workflows:run` key |

```bash
curl -X POST "$APP_URL/api/v1/agents/AGENT_ID/run" \
  -H "Authorization: Bearer $NBY_API_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Research Globex and summarise their pricing"}'
```

Webhooks take a JSON object body and require one of two forms of authentication:

- `X-NBY-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Timestamps must be within 5 minutes.
- A `workflows:run` API key.

Send `Idempotency-Key` so retries never start a second run. Reveal or rotate the signing secret in the workflow builder.

## Testing

```bash
npm run typecheck && npm run lint
npm test                    # unit + integration (Vitest) against the nby_test database
npm run test:e2e            # Playwright: production build on :3100 with its own nby_e2e database
```

- **Integration tests** use real PostgreSQL (`tests/setup.ts` forces `nby_test`) and a scripted model. They cover:
  - the runtime, approvals and resume;
  - tenancy, the permission engine and knowledge;
  - the workflow engine and templates;
  - the public API, webhooks, admin, security, analytics and the dashboard.
- **E2E** (`tests/e2e`):
  - the full spec §137 acceptance scenario through the UI;
  - auth (sign-up, login, logout, password reset, invitation);
  - an axe accessibility audit of key pages.
- The `EMAIL_PROVIDER=file` mailbox lets E2E read reset and invitation links.
- First run: `npx playwright install chromium`.

## Deployment

**Railway (recommended):** follow [docs/deploy-railway.md](docs/deploy-railway.md). `railway.json` in the repo root configures the build, pre-deploy migrations, start command and health check (`/api/health`).

**Any other Node host:**

1. Provision PostgreSQL (and optionally Redis). Set `DATABASE_URL`, `APP_URL` (https), `ENCRYPTION_KEY`, `SIGNING_SECRET`, `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`, and AI keys as needed.
2. Run `npm ci && npm run db:generate && npm run build && npm run db:deploy`.
3. Run the web server (`npm start`) with `EMBEDDED_WORKER=false`, plus one or more `npm run worker` processes.
4. Uploaded files are stored under `STORAGE_LOCAL_DIR`. Use a persistent volume, or add an object-storage driver in `lib/storage`.

Deploy behind at least one reverse proxy or load balancer, and set `TRUSTED_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For`.

Security headers (CSP, HSTS on https, frame denial, nosniff) are set in `next.config.ts`. Session cookies are `Secure` whenever `APP_URL` is https.

## Security

- **Tenant isolation**: the company is always derived from the server-side session; every query is scoped by organization. Tests cover cross-tenant access.
- **Authorization**: role-based permissions on every server action. Platform admin is separate from company roles. API keys are scoped.
- **Runtime enforcement**: permissions, policies, approval rules, budgets and limits are checked on the server for every tool call, so the model can't bypass them.
- **Prompt-injection defense**: documents, web pages, emails, tool results and substituted workflow data are wrapped as untrusted data, and the system instructions forbid following them.
- **Secrets**: credentials are AES-256-GCM encrypted. API keys are hashed. Webhook secrets are encrypted, and revealing or rotating them is audited. Emails print bodies (e.g. reset links) only outside production.
- **Rate limits**: login, signup and reset; API, webhooks, employee and workflow runs, uploads and AI requests. Limits are keyed per company, user and key.
  - Login is also limited per account, independent of IP.
  - Client IPs come only from proxy-appended `X-Forwarded-For` entries (`TRUSTED_PROXY_HOPS`); a client can't spoof them past your proxy.
- **Uploads**: type sniffing, size limits, and forced-download serving with `nosniff`. Cookie-authenticated upload routes also check the Origin header.
- **SSRF**: see [Integrations and tools](#integrations-and-tools). OpenAI-compatible base URLs are re-resolved and checked before each use.
- **Audit log**: every sensitive action is recorded (Settings → Audit log).
- **Dependency advisories** (`npm audit --omit=dev`), reviewed and not reachable:
  - `deepmerge-ts` and `mysql2` sit inside the Prisma CLI tooling; we use PostgreSQL, and the CLI only merges local config.
  - `uuid` (via `exceljs`) is only vulnerable when a caller-supplied buffer is used with v3/v5/v6, which exceljs doesn't do.
  - Each fix is a breaking downgrade, so the dependencies are monitored instead.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Environment is invalid: ENCRYPTION_KEY …` | Set a 32-byte base64 key (see [Environment setup](#environment-setup)). |
| Embedded Postgres won't start ("shared memory block") | A previous `postgres.exe` from this project is still running. Stop it, then `npm run db:start` again. |
| New columns missing / "Unknown argument" errors after a migration | Run `npm run db:generate` and **restart** `next dev`, which caches the old Prisma client. |
| Jobs never run (tasks stay "Queued") | Make sure a worker is running (embedded, or `npm run worker`). Check `/admin/health`. |
| Employees answer "I couldn't find approved company knowledge" | They're on the offline demo model. Add an AI provider key. |
| Emails aren't delivered | `EMAIL_PROVIDER=console` only logs them. Configure Resend for delivery. |
| Webhook returns 401 | Sign the exact raw body with the current secret and a fresh timestamp, or send a `workflows:run` API key. |
