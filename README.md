# TavrenOPS

Internal operations for Tavren: projects, tasks, work logs, blockers, and
automatic Google Sheets sync for client-facing timesheets.

The design brief and full backlog live in [docs/tavOps.md](docs/tavOps.md).

## What v1 does

One developer submission fans out to everything else:

```
Log work  ->  work_logs row
          ->  task status + freshness clock
          ->  reviewer notification
          ->  queued Google Sheets row
          ->  clears the "you owe an update" inbox item
```

Everything commits in one transaction. The Sheets API call happens out of band
in a worker, so a slow Google response never sits between a developer and their
submit button.

| Module | State |
| --- | --- |
| Auth + roles (admin / pm / delivery_lead / sales / developer / collaborator) | Working |
| Projects, scoped per user | Working |
| Tasks with status workflow | Working |
| Work logs, task-level and project-level | Working |
| Blockers with automatic routing and SLA escalation | Working |
| Needs-attention inbox with de-duplication | Working |
| Sheets sync queue, retry/backoff, failure alerting | Working |
| Live Google Sheets write | Needs credentials — see below |
| Sales pipeline, QA checklists, change requests, dashboards | Not in v1 |

## Running it

```bash
docker compose up -d          # Postgres on :5433
cp .env.example .env.local    # then fill in the secrets below
pnpm db:migrate
bash scripts/bootstrap.sh     # creates the least-privilege app role
pnpm db:seed                  # the Tavren team + two sample projects
pnpm dev
```

Seeded accounts all use the password `tavren123` (development only).
Sign in as `hammad@tavren.io` for the PM view or `ayan@tavren.io` for a
developer's.

### Secrets

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Connects as `tavren_app`. Must NOT be a superuser — see below. |
| `MIGRATION_DATABASE_URL` | Owner role. Used only by drizzle-kit. |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | Guards `/api/cron/*`. `openssl rand -hex 24` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` | Sheets sync |

### Google Sheets setup

1. Create a Google Cloud project, enable the **Sheets API**.
2. Create a **service account**, download the JSON key.
3. Put `client_email` and `private_key` into `.env.local` (keep the `\n`
   escapes in the key).
4. Share each client spreadsheet with the service-account address as **Editor**.
5. Add a row to `sheet_mappings` for the project, mapping Tavren fields to
   column letters.

Sheets API quota is 300 writes/minute per project and costs nothing, which is
far beyond what a dozen developers generate. The failure mode to plan for is a
revoked share or a renamed tab, not volume — both surface as an actionable
inbox item for an admin after three failed attempts.

## Scheduled jobs

Two endpoints, both requiring `Authorization: Bearer $CRON_SECRET`:

| Endpoint | Cadence | Does |
| --- | --- | --- |
| `POST /api/cron/sync` | every 2–5 min | Drains the Sheets sync queue |
| `POST /api/cron/sweeps` | hourly | Escalates blockers, flags stale tasks, recomputes project health |

Note that Vercel's Hobby tier only runs cron **once per day** and forbids
commercial use, which makes it a poor fit. Use a cheap VPS, Cloudflare Workers
cron triggers, or any external scheduler hitting these URLs.

## Security model

Access control is **app-layer RBAC**, defined once in
[src/lib/rbac.ts](src/lib/rbac.ts) as capabilities rather than role-name checks.
Project scoping lives in [src/lib/access.ts](src/lib/access.ts) and every
fetch-by-id goes through it — an unauthorised project id returns 404, not 403,
so ids cannot be probed.

Two tables carry a **row-level security backstop** on top of that:
`project_financials` and `user_rates`. They return zero rows unless the caller
opts in for that transaction via `withFinanceAccess()`. This is defence against
a future forgotten `WHERE` clause, not a substitute for the RBAC check.

For those policies to bind at all, the app must connect as `tavren_app`
(`NOSUPERUSER`, `NOBYPASSRLS`). **A superuser connection string silently
disables the entire backstop** — Postgres superusers bypass RLS unconditionally,
`FORCE` included. `scripts/bootstrap-roles.sql` creates the role correctly.

Nobody on the team should hold database credentials. RLS does not protect
against a table owner; not handing out connection strings does.

## Layout

```
src/db/schema.ts        13 tables, the whole data model
src/lib/rbac.ts         capabilities per role
src/lib/access.ts       project scoping / IDOR defence
src/lib/business-time.ts SLA clocks that skip nights and weekends
src/server/work-logs.ts the fan-out described above
src/server/blockers.ts  routing + client clock-stop
src/server/sweeps.ts    escalation, stale detection, health
src/server/sync-worker.ts queue drain with backoff
drizzle/                migrations, including the RLS backstop
```

## Two design decisions worth knowing

**Client delays never count against a developer.** A blocker categorised
`waiting_on_client` is marked client-owned: it routes to the sales owner rather
than the delivery lead, and the stale-task sweep skips any task with an open
blocker. Nagging someone for an update on work they have already reported they
cannot proceed with is how a reporting system loses credibility.

**Lifecycle and health are separate fields.** `draft/active/completed/archived`
is where a project is; `on_track/at_risk/blocked` is how it is doing. Health is
derived by the sweep from blockers and overdue tasks, never set by hand, so the
dashboard cannot drift from reality.
