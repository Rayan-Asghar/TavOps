# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.
> **The plan is `docs/ROADMAP.md`.** This file is only "where we are right now".

## Goal

A strictly internal, Postgres-centred operations system: the web app writes to
PostgreSQL; reporting and the one-way mirrors read from it.

## Branch topology — read this first

`main`, and **everything is merged into it** — `sales-ops` is fully contained
and can be deleted. **69 commits are UNPUSHED**: the push was blocked by a
session permission rule, not by anything wrong with the tree. Do not trust a
count written here; run `git rev-list --count origin/main..main`.

`pnpm verify` (441 unit) and `pnpm test:db` (224 fixture) green; build green at
`NODE_OPTIONS=--max-old-space-size=4096`. **Do not build while `next dev` runs.**
**Do not run `pnpm test:db` while another session is** — use
`TEST_DB_NAME=<name>_test pnpm test:db` for your own database; it must end in
`_test`, which is what stops the harness truncating anything else.

⚠️ **Up to six Claude sessions run against this repo at once.** Commit with
`git commit --only -F <msgfile> -- <explicit paths>`, never `git add -A`; a new
file needs an explicit `git add` first, as `--only` cannot name an untracked one.

**Migration `0025` is taken. Take `0026`** — and check with
`git log --all --diff-filter=A --name-only -- 'drizzle/*.sql'`, not by reading
the local directory, because the number you take is only ever wrong relative to
a branch you cannot see. Four collisions happened in one day that way.

## Current State — phases 1, 2A, 2B.1/2B.2, S done; Phase 5 is five of six

**Phase S — sales operations** merged this session (migrations `0024`, `0025`).
The role had one screen that logged proposals and nothing that helped anyone
sell. It now has a chase queue derived from the status and the clock, a pipeline
record with a detail route and lost reasons, a connects ledger, and the blockers
`resolveBlockerRouting` always routed to the deal owner without ever showing
them. `worklog.create` came off the role — a rep logs no hours, and `/log` and
`/timesheet` had no capability gate at all until that exposed it.

Before it: invitations on `0023`, the interface rebuilt against
`DESIGN-STANDARD.md`, the shell moved into `src/app/(app)/layout.tsx`, and a
Vercel/Supabase deploy guide. Reasoning is in PROGRESS.md, 2026-09-07.

## Next Steps

1. **Regenerate the snapshots.** `drizzle/meta/` has none for `0024`/`0025`,
   deliberately — the one generated on the branch predated `saved_views` and
   would make the next `db:generate` emit a spurious `CREATE TABLE`. Run
   `pnpm db:generate`, keep the JSON, **delete the `.sql` beside it**.
2. **Phase 5.7 — per-person money permissions**, in `docs/ROADMAP.md`. `can()`
   gets *overloaded* rather than taking a third argument, so all 24
   `finance.view`/`rates.view` call sites stop typechecking until each passes an
   actor — the compiler finds them, not a grep. Read `src/lib/authz.ts` first.
3. **Login rate limiting** — the last Phase 5 item. Needs a table.
4. **Phase 2B.3 onward**, then 2C (paste an Upwork posting to pre-fill a
   proposal — note it must also fill connects and boost, or the ledger drifts
   from the first bid).

## What Failed / Dead Ends

- **THE PATTERN worth checking first: one rule, two implementations, drifting
  units.** The chase cutoff was calendar days in SQL and business hours in TS,
  so the rail badge, the chase list and each row's own column disagreed across a
  weekend. The connects burn divided a calendar window by calendar days under a
  label saying working days. Both now derive from ONE function. Four of ten
  defects found in one pass had this shape.
- **`notify()` cannot overwrite a row already holding its dedupe key** — the
  upsert clears a snooze and nothing else, not `resolved_at`. Since
  `resolveNotification` is the inbox's Dismiss button, five alerts were
  one-shot. Two fixes: a chase cycle is a NEW ask so its key carries
  `:<chaseCount>`; a recurring condition passes the opt-in `reopen`, which
  refreshes a closed or snoozed row only.
- **A session-level advisory lock released through a pool is not released** —
  `db.execute` takes any free connection. Intermittent, which is why it read as
  dormant. `sync-worker.ts` now pins it to `pool_.reserve()`.
- **`drizzle-kit migrate` applies in TIMESTAMP order against the single newest
  applied row**, so anything older is skipped in silence — and a hand-written
  migration is invisible until it is in `_journal.json`. `generate` models
  neither RLS nor CHECK constraints.
- **A correlated subquery must not interpolate `${table.column}`** — drizzle
  renders it unqualified and returns 0 with no error.
- **An RLS-forced table cannot be filtered from an ungated query** — `NOT EXISTS`
  matches EVERYTHING, and so does `inArray(id, [])`. Never fold `work_log_costs`
  into `work_logs`, and never reset the finance GUC in a `finally`.
- **Every export of a `"use server"` module is a callable endpoint**, and such a
  module may only export async functions. **`test.env` does not reach
  `globalSetup`.** **Never `::float` on a money aggregate**; hours are fine.
- Shorter traps — `sql<Date>`, unchecked checkboxes, `overflow-x-auto` and
  sticky, callback refs, `afterAll(owner.end)` inside a describe, the grid, CDP,
  Drive and shadcn — are in `.claude/handoff-history/`.

## Open Questions / Blockers

- **Dev still has the nine shared-password accounts** (seed fix is forward-only).
- **`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` unset**, so the Google button is
  hidden. Needs a Google OAuth *Web application* client, NOT the Sheets service
  account already in `.env.local`.
- **Hosting** — Phase 6, explicitly last by the owner's instruction, though a
  Vercel/Supabase test environment is now documented.
- **`CONNECTS_FLOOR` is a constant** — `/settings` in Phase 5. Seeded logs carry
  no revisions or costs; the digest webhook URL is unset.
