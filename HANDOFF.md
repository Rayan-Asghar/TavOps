# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.
> **The plan is `docs/ROADMAP.md`.** This file is only "where we are right now".

## Goal

A strictly internal, Postgres-centred operations system: Web App → PostgreSQL
(single source of truth) → reporting and one-way mirrors. History in PROGRESS.md.

## ⚠️ You are on `sales-ops`, in a worktree — read this first

Working directory is **`/home/rayan/Desktop/TavrenOPS-sales`**, a worktree on
`sales-ops`, branched from `main` at `5de72b5`. The primary (`../TavrenOPS`) is
a **different session's** checkout of `main`. A worktree was used because a
working directory has one HEAD: `git checkout -b` there would have switched
branches under that session mid-work.

- `node_modules` is not shared; `.env.local` has **`AUTH_URL` on :3001**, so
  run `PORT=3001 pnpm dev`. **`next typegen`** before the first `typecheck`.
- **Run fixtures isolated**: `TEST_DB_NAME=tavren_ops_sales_test pnpm test:db`.
- **Never `pkill -f "next dev"`** — it matches its own command chain and killed
  the other session's server twice. Match on the directory.

## Current State

Ten commits, tree clean, **nothing merged to `main`**. `pnpm verify` (406 unit)
and isolated fixtures (208) green on repeat; every route driven in a browser
for a sales user and a head, no page errors.

**All of `docs/ROADMAP.md` § Phase S is done (S0–S3)** — the sales role has a
chase queue, a pipeline record with a detail route, a connects ledger, and the
blockers already routed to it. Migrations `0023`, `0024`.

Then two bug passes, which found more in the existing code than in the new:
**the sync drain leaked its own advisory lock** (sheet sync could stop silently
until a restart), **five alerts could only ever fire once**, and **two rules
were implemented twice in units that only matched some of the time**. Ten
defects; the pattern is below and it is worth reading before writing more.

## Next Steps

1. **Merge to `main`, then regenerate the snapshots.** `drizzle/meta/` has none
   for `0023`/`0024`, deliberately: the `0023` one was built against `0020` and
   did not know `saved_views` existed, so keeping it would make the next
   `db:generate` emit a spurious `CREATE TABLE`. After merging run
   `pnpm db:generate`, keep the JSON, **delete the `.sql` beside it**.
2. **Phase 5 hardening**, per `main`'s handoff — seed passwords, rate limiting,
   session revocation. `/uxaudit` still has not been re-run.

## What Failed / Dead Ends

- **THE PATTERN: one rule, two implementations, drifting units.** The chase
  cutoff was calendar days in SQL and business hours in TS, so the rail badge,
  the chase list and each row's own Cold-for column disagreed across a weekend.
  The connects burn divided a calendar window by calendar days while the tile
  said "working days", overstating runway by a quarter. Both now derive from
  ONE function — SQL takes timestamps from `addBusinessHours`. Look for this
  shape first; it produced four of the ten defects found.
- **`notify()` cannot overwrite a row already holding its dedupe key.** The
  upsert clears a snooze and nothing else — not the title, not `resolved_at`.
  So any resolved row blocks the next occurrence, and `resolveNotification` is
  the inbox's Dismiss button. Two fixes, and the difference matters: a chase
  cycle is a NEW ask, so its key carries `:<chaseCount>`; low connects, stale
  tasks, project health and estimate overruns are ONE condition recurring, so
  they pass the opt-in `reopen` — which refreshes a closed or snoozed row only,
  or an hourly sweep would rewrite `created_at` and reshuffle the inbox.
- **A session-level advisory lock released through a pool is not released.**
  INTERMITTENT: `db.execute` takes whatever connection is free, so lock and
  unlock often land on the same one; when they do not, every later drain
  returns "another drain is running". Use `pool_.reserve()` — a
  transaction-scoped lock is out here, a drain makes Sheets calls.
- **Migration numbers collided three times, once silently.** Another session
  took `0021` then `0022` and applied the latter to the shared dev DB 80s after
  this branch journalled its own; drizzle applies only what is newer than the
  last applied, so it printed "applied successfully" and wrote nothing. Also
  why `followup_due`'s surviving rows had to be deleted in `0023`. **Re-check
  `drizzle/` and `_journal.json` before writing, and serialise migration work.**
- **A shared test database lies to you.** 11–53 failures, a different set each
  run, FK violations against rows that should exist — the other worktree
  truncating the same `tavren_ops_test`. Use `TEST_DB_NAME` (must end `_test`);
  `test.env` does NOT reach `globalSetup`, so the config also publishes the
  owner URL into `process.env`.
- Smaller traps: **`afterAll(owner.end)` inside a describe** kills the
  connection for later blocks; **a bare zero against `pg_locks`** is
  cluster-wide, so compare to a baseline; **a `"use server"` module may only
  export async functions**; **bound parameters arrive untyped**, so a `CASE`
  over them is `text`; **`ON DELETE SET NULL` fights a CHECK**.
- **`drizzle-kit generate` models neither RLS nor CHECKs** (it omitted all six
  in `0024`), and **`work_log_costs` must never become columns on `work_logs`**.
- **Never `::float` on a money aggregate** — `::text` or `::bigint` cents;
  hours as float is fine. Grid, CDP, Drive API, `loading.tsx` and the
  finance-GUC `finally` are in `.claude/handoff-history/`.

## Open Questions / Blockers

- **`0023`/`0024` are applied to the shared dev DB.** Additive except one
  CHECK: `main`'s `advanceProposal` sets `status='lost'` with no reason and
  fails that transition until this merges.
- **Two concurrent reconciles** could each record a drift (READ COMMITTED); a
  human action, and both rows survive. **`CONNECTS_FLOOR` is a constant** —
  `/settings` in Phase 5. Seed accounts share `tavren123`; digest webhook unset.
