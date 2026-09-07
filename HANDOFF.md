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
a **different session's** checkout of `main` and has moved on. A worktree was
used because a working directory has one HEAD: `git checkout -b` there would
have switched branches under that session mid-work.

`node_modules` is not shared; `.env.local` was copied with **`AUTH_URL` on
:3001**, so run `PORT=3001 pnpm dev`. **`next typegen` before the first
`pnpm typecheck`** in a fresh worktree. **Never `pkill -f "next dev"`** — it
matches its own command chain and killed the other session's server twice.

## Current State

Four commits on `sales-ops`, tree clean, **nothing merged to `main`**.
`pnpm verify` (406 unit) green. Run fixtures ISOLATED —
`TEST_DB_NAME=tavren_ops_sales_test pnpm test:db` (188, green three runs
running); see the shared-database dead end below.

**All of `docs/ROADMAP.md` § Phase S is done (S0–S3)**, each verified in a
browser against real data rather than only by tests.

- **S0** — `worklog.create` off `sales`; `/log` + `/timesheet` got the
  `can() → notFound()` gate they never had; `/reports` narrowed not withheld;
  `/start` resolves landing by capability; Sales moved to TODAY with a badge.
- **S1** (`0023`) — `lib/chase.ts`, `flagFollowUpsDue`, real pagination,
  `/sales/[id]`, lost reasons, client linking, audit on `advanceProposal`.
- **S2** (`0024`) — one append-only signed `connect_ledger`, `/sales/connects`,
  `flagLowConnects`, reconcile-with-a-required-note.
- **S3** — "Waiting on you", the narrowed blocker form,
  `tests/db/sales-visibility.test.ts`, `TEST_DB_NAME`.

## Next Steps

1. **Merge to `main`, then regenerate the snapshots.** `drizzle/meta/` has none
   for `0023`/`0024`, deliberately: the `0023` one was generated against `0020`
   and did not know `saved_views` existed, so keeping it would make the next
   `db:generate` emit a spurious `CREATE TABLE`. After merging run
   `pnpm db:generate`, keep the JSON, **delete the `.sql` it emits**.
2. **Phase 5 hardening**, per `main`'s handoff — seed passwords, login rate
   limiting, session revocation. `/uxaudit` still has not been re-run.

## What Failed / Dead Ends

- **A shared test database lies to you.** `pnpm test:db` returned 11–53
  failures, a different set each run, with FK violations against rows that
  should exist and occasional deadlocks — which reads exactly like a race in
  the code under test. It was the OTHER worktree truncating the same
  `tavren_ops_test`. Proved by sampling `pg_stat_activity` mid-run: two
  TRUNCATEs, two harnesses. Use `TEST_DB_NAME`; it must still end in `_test`.
- **`test.env` does not reach `globalSetup`.** It runs in the main process and
  falls back to its own default, creating and migrating the SHARED database
  while tests talk to another. The config now publishes the owner URL to
  `process.env`.
- **Migration numbers collided three times, once silently.** Another session
  took `0021` then `0022`, applying the latter to the shared dev DB 80 seconds
  after this branch journalled its own; drizzle applies only what is newer than
  the last applied, so it printed "applied successfully" and wrote nothing.
  **Re-check `drizzle/` and `_journal.json` immediately before writing, and
  serialise migration work across sessions.**
- **A dead notification kind is not free to revive.** `followup_due` survived
  the `0011` strip *and so did its rows*, on the same `followup:<id>` key.
  `notify()` upserts on `(user_id, dedupe_key)` and on conflict only clears a
  snooze — it never rewrites title, body or the new `proposal_id`. Nine stale
  rows shadowed everything the sweep wrote: `flagged: 9`, nothing written.
  `0023` deletes them; a fixture test pins why.
- **A `"use server"` module may only export async functions** — `chaseDedupeKey`
  lives in `proposal-schemas.ts` for that reason.
- **Bound parameters arrive untyped**, so a `CASE` built from them is `text` and
  `text * interval` is not an operator; `proposal-queries.ts` casts `::int`.
- **`ON DELETE SET NULL` fights a CHECK** — `connect_ledger.proposal_id` is
  RESTRICT, or the FK's UPDATE violates `cl_bid_needs_proposal`.
- **A level-keyed alert must fire only the level reached**, or L1 and L2 land
  together saying one thing.- **`work_log_costs` must never become columns on `work_logs`**, and
  **`drizzle-kit generate` models neither RLS nor CHECKs** — it omitted all six
  in `0024`. Migrations stay hand-written.
- Grid, CDP, Drive API, `loading.tsx`, the finance-GUC `finally` and the pooled
  advisory lock: `.claude/handoff-history/`.

## Open Questions / Blockers

- **`0023`/`0024` are applied to the shared dev DB.** Additive except one
  CHECK: `main`'s `advanceProposal` sets `status='lost'` with no reason and
  fails that transition until this merges.
- **`CONNECTS_FLOOR` is a constant, not a setting** — `/settings` in Phase 5.
- **Nothing reads `chase_count` in bulk** — the "close it out" state renders
  per row, with no way to act on several at once.
- Seed accounts still share `tavren123` here; digest webhook unset.
