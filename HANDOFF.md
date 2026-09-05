# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.
> **The plan is `docs/ROADMAP.md`.** This file is only "where we are right now".

## Goal

A strictly internal, Postgres-centred operations system: Web App → PostgreSQL
(single source of truth) → reporting and one-way mirrors. History in PROGRESS.md.

## Branch topology — read this first

`main`, **36 commits ahead of `origin/main`. Nothing is pushed.** `redesign` and
`timesheet-grid` are merged; ignore them.

Tree clean. `pnpm verify` (387 unit) and `pnpm test:db` (153 fixture) green,
production build green at `NODE_OPTIONS=--max-old-space-size=4096`.
**Do not build while `next dev` is running** — 4096 is enough alone but not
alongside a dev server, and an unexplained exit 137 is almost always that.

⚠️ **Up to six Claude sessions run against this repo at once.** The index is
shared. Commit with `git commit --only -F <msgfile> -- <explicit paths>`, never
`git add -A` — a PreToolUse hook denies bulk staging. New files must be
`git add`-ed by explicit path first; `--only` cannot reference an untracked one.

## Current State

**Phases 1 and 2A of `docs/ROADMAP.md` are done, plus 2B.1/2B.2.** The money
layer exists end to end and is visible on every screen it belongs on.

Migrations this session: `0019` commercial foundation, `0020` job_runs,
`0021` saved_views. All hand-written, all diffed against the live DB first.

- **Money**: `billing_model` + `retainer_periods`, `task_types` (billability is
  INHERITED, never asked per entry), `billable` on logs and revisions,
  `work_log_costs` (RLS-forced, its own table), `pnpm db:backfill-costs`.
- **Writers that did not exist**: rates on `/admin/users`; billing model,
  financials and retainer periods on `/projects/[id]?tab=money`.
- **Screens**: money on the project list (both density modes), `/clients`,
  `/reports` two-tier strip (closes `C5`), `/tasks`, saved views.
- **In-app scheduler**: `/api/heartbeat` + `src/server/scheduler.ts`. The browser
  is a clock source only; the server decides what is due from `job_runs`. **This
  removed the "hosting blocks automation" chain.**
- **Google sign-in**: one `maySignIn` rule for both providers, **no
  auto-provisioning**. Needs `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` from a Google
  OAuth *Web application* client (NOT the Sheets service account) or the button
  stays hidden.

## Next Steps

1. **Phase 5 hardening before the agency uses this.** Nine seed accounts share
   `tavren123`, there is no login rate limiting, and deactivating somebody
   leaves them signed in for up to 12h. None of it blocks feature work; all of
   it blocks real use.
2. **Phase 2B.3 onward** — filter chips + grouping as one system (client
   grouping on `/projects` was deferred to land there), then view switchers,
   table conventions, global search over content.
3. `/uxaudit` has NOT been re-run. The ~60/92 figure was scored by the session
   that did the work, so it is not evidence.

## What Failed / Dead Ends

- **A correlated subquery must not interpolate `${table.column}`.** Drizzle
  renders it UNQUALIFIED (`"id"`), so Postgres resolves it against the inner
  table: `w.project_id = "id"` compared a work log to its own id, matched
  nothing, returned 0 with no error. Write `projects.id` out longhand. Existing
  subqueries that pass unaliased drizzle table objects are fine.
- **`sql<Date>` is a claim, not a conversion**, and a raw `sql` template binds a
  `Date` differently from drizzle's operators. Use `gt()`/`lte()`, and expect a
  string back from any raw expression.
- **`work_log_costs` must never become columns on `work_logs`** — that table is
  read by the grid, both CSV exports and `reports.ts::timesheet`, none of which
  open the finance gate. `tests/db/rls.test.ts` asserts it.
- **An RLS-forced table cannot be filtered from an ungated query.** `NOT EXISTS`
  against `work_log_costs` inside `timesheet()` sees zero rows and matches
  EVERYTHING. Resolve ids in a gated query and pass them in — and guard the
  empty list, because `inArray(id, [])` is `IN ()` and matches everything too.
- **Every export of a `"use server"` module is a callable endpoint.** A query
  taking a `userId` there lets any caller read another user's rows.
- **`drizzle-kit generate` models neither RLS nor CHECK constraints.**
  Migrations stay hand-written; only the snapshot is generated.
- **An unchecked HTML checkbox sends nothing** — use `readTriStateCheckbox`.
- **Do not reset the finance GUC in a `finally`**: on a SQL error the
  subtransaction is already aborted, so the reset masks the real error.
- **A session-level advisory lock belongs to a CONNECTION and `db` is a pool**,
  so `pg_advisory_unlock` can release nothing. `scheduler.ts` uses the xact
  variant; **`sync-worker.ts:490` still has the hazard.**
- **`pkill -f "next dev"` matches its own command chain.** Bracket the pattern.
- **`setState` in an effect is a lint error**; a `RefObject` effect cannot see a
  conditionally-mounted form — use a callback ref.
- Grid, CDP, Drive API, `loading.tsx` and rejected-shadcn notes live in
  `.claude/handoff-history/`.

## Open Questions / Blockers

- **Hosting** — Phase 6, and **no longer blocks automation**. Needs only Node +
  Postgres, not cron. Nothing runs overnight or over a weekend, which is fine
  for these three jobs. GoDaddy/Hostinger *shared* hosting cannot run this; a
  VPS can.
- **`retainer_periods` has one writer and no reader on the project list** —
  a retainer's period burn shows on the money tab only.
- **Seeded logs carry no revisions or costs** (routing the seed through
  `recordWorkInTx` would break the staleness-sweep fixtures).
- **Discord/Slack webhook URL** for the digest is still unset.
