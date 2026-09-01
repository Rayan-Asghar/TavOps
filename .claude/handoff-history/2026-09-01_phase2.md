# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoff archived at `.claude/handoff-history/2026-09-01_phase1.md`.

## Goal

Turn TavrenOPS into a clean, understandable, **strictly internal**
Postgres-centred operations system: Web App → PostgreSQL (single source of
truth) → reporting. No client portals, client sheets, billing or external
access. Full audit and phased plan:
`~/.claude/plans/can-you-explain-to-wiggly-canyon.md`.

## Current State

**Phase 1 of 5 is complete and committed. 94 tests pass, build green, app runs.**

The client-facing Google Sheets sync is gone — the one subsystem that
contradicted the target architecture. Source is **−2,616 lines / +54**.

- **Deleted**: `sheets.ts`, `sheets.test.ts`, `sync-worker.ts`, `sheet-actions.ts`,
  `sheet-queries.ts`, `sheet-schemas.ts`, `sheet-config.tsx`,
  `api/cron/sync/route.ts`, `scripts/sheets-doctor.ts`, `scripts/attach-sheet.ts`,
  and the `googleapis` dependency.
- **Schema**: 21 tables → **17**. `drizzle/0009_remove_client_sheets.sql` applied.
  Dropped `sheet_connections`, `sheet_row_links`, `sheet_templates`, `sync_jobs`,
  `tasks.sheet_row_ref`, `work_logs.client_update`,
  `worklog_revisions.{client_update,connection_id,row_hash}`,
  `audit_log.sync_job_id`, and 6 enum types.
- **`recordWorkInTx`** (`src/server/record-work.ts:47`) is now purely internal
  bookkeeping: work log + revision v1 + task status + nag clear + reviewer
  notify. Returns `{entry, revision}`. Verified against the live DB in a
  rolled-back transaction — v1 written, `current_revision_id` correct.
- **Work logs carry one note.** The internal/client split existed only to feed
  the sheets; the second field is gone from all three log surfaces
  (`log-work-form.tsx`, `quick-log.tsx`, `task-timer.tsx`).
- **RBAC**: `sheet.configure`, `sheets.client.manage`, `sheets.admin` removed.
  The project-role overlay survives on `deadline.viewClient` and its tests were
  re-pointed there, so the mechanism is still covered.
- Data preserved: 15 work logs, 15 revisions, 7 tasks.

**Backup before the destructive migration:**
`/home/rayan/Desktop/tavrenops-backups/pre-0009-20260901-213816.sql` (97K,
outside the repo). It is the only copy of the dropped `client_update` values.

## Next Steps

1. **Phase 0 — hosting + scheduler (Rayan, blocks everything automatic).**
   Nothing runs on a timer today. Schedule `/api/cron/sweeps` hourly and
   `/api/cron/digest` daily with `CRON_SECRET`. Vercel Hobby is out.
   Set `DIGEST_WEBHOOK_URLS` or the digest builds and goes nowhere.
2. **Phase 2 — close the internal record loop.** The highest-value remaining
   work, and what employees will hit in week one:
   - `editWorkLog` / `deleteWorkLog`. The schema is already built for it —
     `deleted_at`, `is_reversal`, the version chain, and the
     `projects.invoiced_through` lock. Today a mistyped 8h is permanent and
     `worklog_revisions` only ever holds v1.
   - One `writeAudit` helper wired into work logs, tasks, projects, blockers and
     reviews. Currently only users/teams/timer/handoff write audit rows and
     **nothing reads the table**, though `audit.view` exists.
3. **Phase 3** — schema/dead-code cleanup; delete the dead `authorized` callback
   in `src/lib/auth.config.ts` (no `middleware.ts` exists, so it never runs);
   check `notifications_dedupe_unique` for the NULL-distinct trap; split the
   673-line `src/app/projects/[id]/page.tsx`.
4. **Phase 4** — `src/server/reports.ts` + `/reports` + CSV export. This is what
   actually replaces the internal spreadsheets.
5. **Phase 5** — DB-fixture tests for access control and the RLS backstop.

## What Failed / Dead Ends

- **`pkill -f "next dev"` kills the agent's own shell** (the pattern matches the
  bash command line). Use `pgrep -af` to check, and a PID.
- **`tsx` scripts are transformed as CJS** — no top-level await. Wrap in
  `main()`. They must also live inside the repo for `../src/...` to resolve.
- **Deleting `.next` breaks `pnpm typecheck`** — `LayoutProps` and friends are
  generated there. Run `pnpm build` once to regenerate.
- **Enum values cannot be dropped in Postgres.** `change_source.'sheet'`,
  `audit_actor_type.'sync'` and `notification_kind.'sync_failed'` survive as
  dead labels, annotated in `src/db/schema.ts`. Never write them.
- **Do not re-add a Stop hook** (`62fa8e5` → `9427490`): it blocked every turn.
- Nine seed accounts still share `tavren123`. Delete once real admins exist.

## Open Questions / Blockers

- **Hosting decision** — blocks step 1, which blocks everything automatic.
- **Discord/Slack webhook URL** needed from Rayan.
- Whether Phase 4 should end in a Google Sheets *export*. `googleapis` was
  removed; re-add it only if that is wanted, and keep it one-way.
