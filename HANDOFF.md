# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.

## Goal

A clean, understandable, **strictly internal** Postgres-centred operations
system: Web App → PostgreSQL (single source of truth) → reporting. No client
portals, client sheets, billing or external access. Full audit and phased plan:
`~/.claude/plans/can-you-explain-to-wiggly-canyon.md`.

## Current State

**Phases 1, 2 and 4 complete and committed. 130 tests pass, build green.**
Phase 3 (cleanup) skipped by choice — it is hygiene, not capability.

- **Phase 1** removed the client-facing sheets sync. −2,616 lines, 21 tables →
  17, `googleapis` dropped.
- **Phase 2** made work logs correctable: `editWorkLog` / `deleteWorkLog` with a
  revision chain and reversal, `projects.invoiced_through` enforced for the
  first time, `writeAudit` wired into the operational tables, `/audit`.
- **Phase 4** put reporting on top of Postgres — the half that actually replaces
  the internal spreadsheets:
  - `src/server/reports.ts` — hours by project (in range, all time, vs estimate,
    vs budget), hours by person against real capacity, and the timesheet. All
    grouped aggregates, never correlated subqueries (see the note in
    `digest.ts` for why that distinction is load-bearing).
  - **`/reports`** — date range in the URL, so a window is shareable and its
    export always matches it. Defaults to the current calendar month.
  - **`/api/reports/timesheet`** — CSV, scoped through the *same* helpers as the
    page, so an export can never contain a row its requester could not see.
  - `src/lib/report-range.ts`, `src/lib/csv.ts`, `businessDaysBetween` in
    `business-time.ts` — pure and tested, 28 new cases.

**Verified against the live DB in a real browser, not just by tests.** For
August 2026 the page, the CSV and direct SQL all agree: 33.05h over 12 entries,
per-person 20.80 / 8.00 / 3.25 / 1.00, capacity 168.00h (21 weekdays × 40/5).
Signed in as a developer: no per-person table, no budget column, timesheet and
CSV both restricted to their own 7 entries summing 20.80.

## Next Steps

1. **Phase 0 — hosting + scheduler (Rayan). Still blocks everything automatic.**
   Nothing runs on a timer. Schedule `/api/cron/sweeps` hourly and
   `/api/cron/digest` daily with `CRON_SECRET`. Vercel Hobby is out.
   Set `DIGEST_WEBHOOK_URLS` or the digest builds and goes nowhere.
2. **Phase 3 — cleanup, still outstanding.** Backfill and drop
   `audit_log.detail` (the older user/team/timer/handoff sites still write it;
   `writeAudit` writes `before`/`after`). Delete the dead `authorized` callback
   in `src/lib/auth.config.ts` — no `middleware.ts` exists, so it never runs.
   Check `notifications_dedupe_unique` for the NULL-distinct trap
   (`dedupe_key` is nullable). Split the ~700-line
   `src/app/projects/[id]/page.tsx`.
3. **Phase 5 — DB-fixture tests** for access control and the RLS backstop. Still
   the only untested high-risk area.
4. Possible additions to `/reports` if wanted: blocker counts and SLA breaches
   by category, review rounds per task. Both are one grouped query each.

## What Failed / Dead Ends

- **`pkill`/`pgrep -f "next dev"` kills the agent's own shell** — the pattern
  matches its own command line. Use a bracket class: `pgrep -af "nex[t] dev"`.
- **Browser harness: never use a global `input[name=...]` lookup.** The project
  page's rail has its own log-work form with `hours`/`internalNotes`. Anchor on
  `input[name=workLogId]`, then `.closest('form')`, and query inside it.
- **`requestSubmit()` silently no-ops on constraint violations.** An hours value
  of 9.99 fails the field's `step="0.25"`, so nothing posts and no error shows —
  identical to a broken action. Call `form.checkValidity()` first.
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
- Google Sheets *export* from a report was left unbuilt on purpose. CSV covers
  what a spreadsheet was for; re-add `googleapis` only if a generated Sheet is
  genuinely wanted, and keep it one-way.
