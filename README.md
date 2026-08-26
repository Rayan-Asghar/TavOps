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
| Auth + roles (7 roles, see below) | Working |
| Admin UI for creating / deactivating people | Working |
| Projects, scoped per user | Working |
| Tasks with status workflow | Working |
| Work logs, task-level and project-level | Working |
| Blockers with automatic routing and SLA escalation | Working |
| Needs-attention inbox with de-duplication | Working |
| Task timer: start / pause / resume / finish, auto work log | Working |
| Timer correction with mandatory reason + audit entry | Working |
| BD pipeline: proposals, feasibility routing, conversion by category | Working |
| Won proposal → draft project handoff | Working |
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
developer's. Delete these before the app touches a real machine and create
real accounts through **People** in the nav.

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

## Roles

| Role | Sees projects | Sees others' activity | Financials |
| --- | --- | --- | --- |
| `admin` | all | yes | yes, incl. pay rates |
| `pm` | all | yes | yes |
| `sales_head` | all | yes | no |
| `delivery_lead` | theirs | own only | no |
| `sales` | theirs | own only | no |
| `developer` | assigned only | own only | no |
| `collaborator` | assigned only, expires | own only | no |

"Activity" means the work-log feed — who logged which hours. A developer sees
only their own entries; the section is titled *Your activity* rather than
silently showing a partial list. Task status and blockers stay visible to
everyone on the project, so a delivery lead can still run reviews without
seeing the whole timesheet.

`sales_head` exists because Muzammil (Sales Manager / BD) and the reps
(Saqlain, Shahab) need different visibility — the head answers for the whole
pipeline, a rep only for their own deals.

## Managing people

**People** in the nav (admins only; the route 404s for everyone else).

- Creating an account generates a 16-character password and shows it **once**.
  It is bcrypt-hashed immediately and is not recoverable — use *Reset password*
  if it is lost.
- The generated alphabet excludes `0/O/1/l/I`, because these get transcribed by
  hand into a chat message.
- Accounts are **deactivated, never deleted**: logged hours have to stay
  attributable to someone.
- Collaborators require an access expiry; it revokes itself on that date.
- An admin cannot deactivate their own account, and the last active admin
  cannot be switched off.
- `user.create`, `user.deactivate` and `user.reset_password` are written to
  `audit_log`.

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

## Time tracking

A developer opens a task, hits **Start**, and the hours are measured rather
than typed. On **Finish** they add a one-line note and the system writes the
work log, moves the task, notifies the reviewer and queues the client sheet —
the same fan-out the manual form uses, via `recordWorkInTx`, so the two paths
cannot drift.

Elapsed time is **never stored as a running total**. `accumulated_seconds`
banks everything up to the last pause and `resumed_at` marks the current
segment, so elapsed is derived as `accumulated + (now - resumed_at)`. A closed
laptop, a killed tab or a server restart loses nothing, because nothing was
being ticked.

One timer per person at a time. Starting a second names the running one rather
than silently stopping it — quietly discarding time somebody is still earning
is worse than refusing. A timer left running past 12h becomes an inbox item for
the person timing it, not their lead: it is a mistake, not misconduct.
Corrections require a reason, and the measured value is kept beside the
correction rather than overwritten.

## Business development

The BD screen answers one question: **is this rep busy, or actually producing
qualified opportunities?** Activity counts and outcome counts live on the same
row, so they can never be reported separately and flatter each other.

Pipeline: `sent → viewed → responded → meeting → qualified → won / lost`. Each
move stamps its own timestamp, so funnel timings come from real events rather
than one mutable "updated" column.

- **Response rate by category** is the number that changes behaviour. Volume
  says a rep is busy; this says which niches are worth bidding on at all.
- A rep can flag **needs a technical read**, which routes the job to a delivery
  lead and lands in their inbox. The lead sees only the proposals routed to
  them — they own none, so an owner-only filter would leave them unable to
  answer.
- Follow-ups default to two days out and become inbox items when they lapse.
- A won proposal carries `won_project_id`: the record *becomes* the sales →
  delivery handoff instead of being retyped.

### The handoff

Marking a proposal **won** puts an actionable item in every PM's inbox — a win
nobody converts is a deal with no delivery attached. Converting creates the
project with everything already known carried across: the rep who won it stays
`sales_owner`, the budget becomes the contract value, the notes become the
scope, and a new client is created if there is not one already. Members are
seeded so the named people can see it immediately.

The project is created as a **draft, never active**. A PM and delivery lead
still have to confirm assets, scope and team before work starts, and a project
that appeared already-running would skip that step.

The internal deadline is validated to fall on or before the client deadline.
An internal date after the client's is not a buffer — it is a missed deadline
waiting to happen.

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
