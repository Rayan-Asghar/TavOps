# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.

## Goal

Turn TavrenOPS into a clean, understandable, **strictly internal**
Postgres-centred operations system: Web App → PostgreSQL (single source of
truth) → reporting. No client portals, client sheets, billing or external
access. Full audit and phased plan:
`~/.claude/plans/can-you-explain-to-wiggly-canyon.md`.

## Current State

**Phases 1 and 2 of 5 complete and committed. 102 tests pass, build green.**

**Phase 1** removed the client-facing sheets sync (−2,616 lines, 21 tables → 17,
`googleapis` dropped). See `.claude/handoff-history/2026-09-01_phase1.md`.

**Phase 2** closed the internal record loop. Verified in a real browser against
the live DB, not just by tests:

- **Work logs can be corrected and removed** — `editWorkLog` / `deleteWorkLog`
  in `src/server/work-logs.ts`. An edit appends revision vN and moves
  `current_revision_id`; a delete soft-deletes and appends a reversal (hours 0,
  `is_reversal`). Both require a reason, as `adjustTimer` already did.
  Proven: 21.00h → 1.75h left v1 intact with the original note; a removal
  dropped the project total by exactly its hours.
- **`projects.invoiced_through` is enforced for the first time.** It existed
  since the first migration and nothing read it. Refuses edit and delete on
  billed work, and refuses moving an entry *into or out of* a billed period.
  Pure predicate extracted to `src/lib/billing-lock.ts` with 6 tests.
- **Own entries are always editable; other people's need `worklog.edit`**
  (new capability, admin + head).
- **Audit is wired into the operational tables** via `writeAudit`
  (`src/server/audit.ts`) — work log create/edit/delete, task create/update,
  review, blocker report/resolve, project create/activate. It takes the caller's
  `tx`, so an audit row cannot commit while its change rolls back.
- **`/audit`** renders the newest 100 entries as field-level diffs, behind the
  pre-existing `audit.view`. Nav entry added.
- **Soft delete is now honoured everywhere.** Four sites counted deleted hours:
  the project activity list and total, `projects/page.tsx`, and two subqueries in
  `review/page.tsx`. Fixed — they were harmless only because nothing could delete.

**Dev data changed by the verification run** (all on junk seed entries): one
NW-001 log corrected to 1.75h, one NW-001 and one BL-002 log removed. Left in
place deliberately — the audit log is append-only and reverting would make it
contradict reality.

## Next Steps

1. **Phase 0 — hosting + scheduler (Rayan, blocks everything automatic).**
   Nothing runs on a timer. Schedule `/api/cron/sweeps` hourly and
   `/api/cron/digest` daily with `CRON_SECRET`. Vercel Hobby is out.
   Set `DIGEST_WEBHOOK_URLS` or the digest builds and goes nowhere.
2. **Phase 3 — cleanup.** Backfill and drop `audit_log.detail` (the older
   user/team/timer/handoff call sites still write it; `writeAudit` writes
   `before`/`after`). Delete the dead `authorized` callback in
   `src/lib/auth.config.ts` — no `middleware.ts` exists so it never runs. Check
   `notifications_dedupe_unique` for the NULL-distinct trap. Split the 700-line
   `src/app/projects/[id]/page.tsx`.
3. **Phase 4 — reporting.** `src/server/reports.ts` + `/reports` + CSV export.
   This is what actually replaces the internal spreadsheets.
4. **Phase 5** — DB-fixture tests for access control and the RLS backstop.

## What Failed / Dead Ends

- **`pkill`/`pgrep -f "next dev"` kills the agent's own shell** — the pattern
  matches its command line. Use a bracket class: `pgrep -af "nex[t] dev"`.
- **Browser harness: never use a global `input[name=...]` lookup.** The project
  page's rail has its own log-work form with `hours`/`internalNotes`. Anchor on
  `input[name=workLogId]`, then `.closest('form')`, and query inside it.
- **`requestSubmit()` silently no-ops on constraint violations.** An hours value
  of 9.99 fails the field's `step="0.25"`, so nothing posts and no error shows —
  it looks exactly like a broken action. Call `form.checkValidity()` first.
- **Deleting `.next` breaks `pnpm typecheck`** (`LayoutProps` is generated
  there). Run `pnpm build` once to regenerate.
- **Enum values cannot be dropped in Postgres.** `change_source.'sheet'`,
  `audit_actor_type.'sync'`, `notification_kind.'sync_failed'` survive as
  annotated dead labels. Never write them.
- **Do not re-add a Stop hook** (`62fa8e5` → `9427490`): it blocked every turn.
- Nine seed accounts still share `tavren123`. Delete once real admins exist.

## Open Questions / Blockers

- **Hosting decision** — blocks step 1, which blocks everything automatic.
- **Discord/Slack webhook URL** needed from Rayan.
- Should Phase 4 end in a Google Sheets *export*? `googleapis` was removed;
  re-add only if wanted, and keep it one-way.
