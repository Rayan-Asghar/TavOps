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
  the other session's server twice.

## Current State

Seven commits, tree clean, **nothing merged to `main`**. `pnpm verify` (406
unit) and the isolated fixtures (198) green on repeat; every route driven in a
browser for a sales user and a head, no page errors.

**All of `docs/ROADMAP.md` § Phase S is done (S0–S3)** — the sales role has a
chase queue, a pipeline record with a detail route, a connects ledger, and the
blockers already routed to it. Migrations `0023`, `0024`.

Then a bug pass, which found more in the existing code than in the new: **the
sync drain leaked its own advisory lock** (sheet sync could stop silently until
a restart) and **five alerts could only ever fire once** — the two added this
week plus three that have been in the sweeps for months.

## Next Steps

1. **Merge to `main`, then regenerate the snapshots.** `drizzle/meta/` has none
   for `0023`/`0024`, deliberately: the `0023` one was built against `0020` and
   did not know `saved_views` existed, so keeping it would make the next
   `db:generate` emit a spurious `CREATE TABLE`. After merging run
   `pnpm db:generate`, keep the JSON, **delete the `.sql` beside it**.
2. **Phase 5 hardening**, per `main`'s handoff — seed passwords, login rate
   limiting, session revocation. `/uxaudit` still has not been re-run.

## What Failed / Dead Ends

- **`notify()` cannot overwrite a row already holding its dedupe key.** The
  upsert clears a snooze and nothing else — not the title, not `resolved_at`.
  So any resolved row blocks the next occurrence, and `resolveNotification` is
  the inbox's Dismiss button. Two fixes, and the difference matters: a chase
  cycle is a NEW ask, so its key carries `:<chaseCount>` and the history
  survives; low connects, stale tasks, project health and estimate overruns are
  ONE condition recurring, so they pass the opt-in `reopen` — which refreshes a
  closed or snoozed row only, or an hourly sweep would rewrite `created_at` and
  reshuffle the inbox every hour.
- **A session-level advisory lock released through a pool is not released.**
  The leak is INTERMITTENT: `db.execute` takes whatever connection is free, so
  lock and unlock often land on the same one. When they do not, every later
  drain returns "another drain is running". Use `pool_.reserve()`. A
  transaction-scoped lock is not an option here — a drain makes Sheets calls.
- **Migration numbers collided three times, once silently.** Another session
  took `0021` then `0022` and applied the latter to the shared dev DB 80s after
  this branch journalled its own; drizzle applies only what is newer than the
  last applied, so it printed "applied successfully" and wrote nothing.
  **Re-check `drizzle/` and `_journal.json` immediately before writing, and
  serialise migration work across sessions.**
- **A shared test database lies to you.** `pnpm test:db` returned 11–53
  failures, a different set each run, with FK violations against rows that
  should exist — the other worktree truncating the same `tavren_ops_test`. Use
  `TEST_DB_NAME` (must end in `_test`). `test.env` does NOT reach
  `globalSetup`, so the config publishes the owner URL into `process.env`.
- **A dead notification kind is not free to revive.** `followup_due` survived
  the `0011` strip *and so did its rows* — nine shadowed everything the new
  sweep wrote (`flagged: 9`, nothing written). `0023` deletes them.
- Smaller traps: **`afterAll(owner.end)` inside a describe** kills the
  connection for later blocks (keep it file-level); **a bare zero against
  `pg_locks`** is cluster-wide, so compare to a baseline; **a `"use server"`
  module may only export async functions**; **bound parameters arrive
  untyped**, so a `CASE` over them is `text`; **`ON DELETE SET NULL` fights a
  CHECK** — `connect_ledger.proposal_id` is RESTRICT.
- **`drizzle-kit generate` models neither RLS nor CHECKs** (it omitted all six
  in `0024`), and **`work_log_costs` must never become columns on `work_logs`**.
- Grid, CDP, Drive API, `loading.tsx`, finance-GUC `finally`: handoff-history.

## Open Questions / Blockers

- **`0023`/`0024` are applied to the shared dev DB.** Additive except one
  CHECK: `main`'s `advanceProposal` sets `status='lost'` with no reason and
  fails that transition until this merges.

- **Two concurrent reconciles** both read the balance under READ COMMITTED and
  could each record a drift; a human action, and both rows survive.
- **`CONNECTS_FLOOR` is a constant** — `/settings` in Phase 5. Seed accounts
  still share `tavren123` here; digest webhook unset.
