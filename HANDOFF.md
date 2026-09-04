# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.
> **The plan is `docs/ROADMAP.md`.** This file is only "where we are right now".

## Goal

A strictly internal, Postgres-centred operations system: Web App → PostgreSQL
(single source of truth) → reporting and one-way mirrors. History in PROGRESS.md.

## Branch topology — read this first

`main`, 8 commits ahead of `origin/main`. **Nothing is pushed.** The `redesign`
and `timesheet-grid` branches are merged; ignore them.

Tree clean, `pnpm verify` (330 unit) and `pnpm test:db` (120 fixture) both green.
**Build needs `NODE_OPTIONS=--max-old-space-size=4096`** or it dies with 137.

⚠️ **Up to six Claude sessions run against this repo at once.** The index is
shared. Commit with `git commit --only -F <msgfile> -- <explicit paths>`, never
`git add -A` — a PreToolUse hook denies bulk staging. New files must be
`git add`-ed by explicit path first; `--only` cannot reference an untracked one.

## Current State

**Phase 1 of `docs/ROADMAP.md` is done: the system now knows how a project earns
and what an hour costs.** The roadmap was written after studying Toggl, Toggl
Track, Plane and Harvest against their pricing tiers; the finding that drives it
is that Tavren has premium-tier engineering (audit log, retroactive rates, RLS)
under a free-tier feature set (no clients screen, no expenses, no money on the
project list).

Shipped in Phase 1 — migration `0019`:
- `projects.billing_model` + `retainer_periods` (T&M / fixed fee / retainer).
  **Retainers were previously inexpressible.** Nothing reads these yet.
- `task_types` — the billable catalogue. Billability is INHERITED from the kind
  of work (`src/lib/billable.ts`), never asked for per entry.
- `billable` on `work_logs` and `worklog_revisions`.
- `work_log_costs` — RLS-forced, its **own table**, deliberately (see below).
- `user_rates` gained its first index and a one-open-rate-per-person constraint.
- `src/lib/rates.ts` (half-open window), `src/lib/margin.ts` (three identities,
  refuses mixed currency), `src/server/costing.ts`, `recostWorkLogs`.
- `scripts/backfill-costs.ts` — run on dev: 23 entries, 17 rated / 6 unrated,
  idempotent on rerun. `pnpm db:backfill-costs`.

## Next Steps

1. **Phase 2B.1 — the page shell — first.** Not 2A. 2A rebuilds the same pages,
   so building the shell afterwards means writing them twice. `docs/ROADMAP.md`
   §2B.1 has the five-band contract; all four studied tools use it.
2. Then 2A: the Harvest-style project list (Budget · Spent · Remaining · Costs),
   the clients directory, the two-tier reconciliation strip on `/reports`.
3. `/uxaudit` has NOT been re-run since the redesign work. Its last score (~60/92)
   was estimated by the session that did the work, so it is not evidence.

## What Failed / Dead Ends

- **`work_log_costs` must never become columns on `work_logs`.** That table is
  read by the grid, both CSV exports and `reports.ts::timesheet`, none of which
  open the finance gate — a cost column there retires the RLS backstop silently,
  with every test still passing. `tests/db/rls.test.ts` now asserts `work_logs`
  has no column matching `%cost%`/`%rate%`. Do not "simplify" this.
- **Do not reset the finance GUC in a `finally`.** On a SQL error the
  subtransaction is already aborted, so the reset throws "current transaction is
  aborted" and masks the real error. `ROLLBACK TO SAVEPOINT` already closes it.
- **A raw `sql` template binds a `Date` differently from drizzle's operators**
  and fails against `timestamptz`. Use `gt()`/`lte()`, not `sql\`a > ${date}\``.
- **`drizzle-kit generate` does not model RLS or CHECK constraints.** It omitted
  the whole policy block for `work_log_costs`. Migrations stay hand-written; only
  the snapshot is generated. `0016`/`0017` still have no snapshots — `0019`'s is
  built on `0018`'s, which is sound.
- **An unchecked HTML checkbox sends nothing**, so `formData.get()` cannot tell
  "unticked" from "no such field". Use `readTriStateCheckbox`.
- **`overflow-x-auto` forces `overflow-y:auto`**, making that wrapper the sticky
  containing block — so the grid has no sticky header, and the fix would move
  geometry its roving-tabindex model depends on.
- **Do not test `loading.tsx` by blocking the RSC request** — the loading UI is
  delivered *in* that stream. Throttle instead.
- **shadcn's Button and Sonner were rejected** (focus-ring opt-out, 24–36px
  targets, `dark:` variants; Sonner needs `next-themes`, which this app avoids).
- **`setState` in an effect is a lint error**; client-only values go through
  `useSyncExternalStore` with a server snapshot. **A `RefObject` effect cannot
  see a conditionally-mounted form** — use a callback ref.
- The grid, CDP and Drive API notes in
  `.claude/handoff-history/2026-09-03_sheets-pre-grid.md` still apply.

## Open Questions / Blockers

- **Hosting** — deferred to Phase 6 by decision. Note GoDaddy/Hostinger *shared*
  hosting cannot run this (needs a Node process, Postgres and real cron); a
  Hostinger VPS can. Blocks every automation until then.
- **Seeded logs carry no revisions or costs.** Routing the seed through
  `recordWorkInTx` would overwrite the `lastUpdateAt` values the staleness sweep
  fixtures depend on. The backfill script skips them for the same reason.
- **Nine seed accounts still share `tavren123`.** Phase 5.
- **Discord/Slack webhook URL** for the digest is still unset.
