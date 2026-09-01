# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.

## Goal

A clean, understandable, **strictly internal** Postgres-centred operations
system: Web App → PostgreSQL (single source of truth) → reporting. No client
portals, client sheets, billing or external access. Full audit and phased plan:
`~/.claude/plans/can-you-explain-to-wiggly-canyon.md`.

## Current State

**All five phases complete and committed. 130 unit + 26 fixture tests, build
green.** The only outstanding work is Phase 0, which is Rayan's.

- **Phase 1** removed the client-facing sheets sync. −2,616 lines, 21 → 17 tables.
- **Phase 2** made work logs correctable (revision chain, reversal,
  `invoiced_through` enforced) and wired `writeAudit` into the operational
  tables. `/audit`.
- **Phase 4** put reporting on Postgres: `/reports`, CSV export at
  `/api/reports/timesheet`, `src/server/reports.ts`.
- **Phase 3** cleanup: `audit_log.detail` retired (all call sites now go through
  `writeAudit`; `drizzle/0010_drop_audit_detail.sql` backfills then drops).
  Project page 660 → 504 lines, queries extracted to
  `src/server/project-queries.ts`, activity tab to `components/project-activity.tsx`.
- **Phase 5** fixture tests — `pnpm test:db`, `pnpm verify:all`.

### Two audit findings that were WRONG, now corrected

- **`auth.config.ts`'s `authorized` callback is LIVE, not dead.** Next.js 16
  renamed Middleware to Proxy: the consumer is `src/proxy.ts`, not
  `middleware.ts`, which is why grepping for the latter found nothing. It gates
  every matched route by default. Deleting it — as the plan said to — would have
  left only the per-page `getActor()` checks, so any page missing one would
  become public. Now documented in the file itself.
- **`notifications_dedupe_unique` is not the NULL-distinct trap.** `dedupe_key`
  is nullable and means "do not collapse this one"; NULLs being distinct is what
  makes every un-keyed notification insert. Making it NULLS NOT DISTINCT would
  cap a person at one un-keyed notification ever. Documented in the schema.

## Next Steps

1. **Phase 0 — hosting + scheduler (Rayan). The only thing left, and it blocks
   everything automatic.** Nothing runs on a timer. Schedule
   `/api/cron/sweeps` hourly and `/api/cron/digest` daily with `CRON_SECRET`.
   Vercel Hobby is out. Set `DIGEST_WEBHOOK_URLS` or the digest goes nowhere.
2. **Delete the nine seed accounts** sharing `tavren123` once real admins exist.
3. Optional: blocker/SLA and review-round breakdowns on `/reports` (one grouped
   query each); a one-way Google Sheets *export* if CSV proves insufficient
   (`googleapis` was removed — re-add only then, and keep it one-way).

## What Failed / Dead Ends

- **`pkill`/`pgrep -f "next dev"` kills the agent's own shell** — the pattern
  matches its own command line. Use a bracket class: `pgrep -af "nex[t] dev"`.
- **Browser harness: never use a global `input[name=...]` lookup.** The project
  page's rail has its own log-work form with `hours`/`internalNotes`. Anchor on
  `input[name=workLogId]`, then `.closest('form')`, and query inside it.
- **`requestSubmit()` silently no-ops on constraint violations.** An hours value
  of 9.99 fails the field's `step="0.25"` — nothing posts, no error, looks
  exactly like a broken action. Call `form.checkValidity()` first.
- **The dev DB owner `tavren` is a SUPERUSER with BYPASSRLS**, so it ignores
  RLS even with FORCE. A test asserting "FORCE blocks the owner" is wrong. What
  actually holds the backstop up is the app connecting as `tavren_app`
  (NOSUPERUSER, NOBYPASSRLS) — asserted in `tests/db/rls.test.ts`.
- **`vitest.config.mts` collects `tests/**`**, so a new suite there runs in the
  pure `pnpm test` too. `tests/db` is explicitly excluded.
- **Deleting `.next` breaks `pnpm typecheck`** (`LayoutProps` is generated
  there). Run `pnpm build` once to regenerate.
- **Enum values cannot be dropped in Postgres.** `change_source.'sheet'`,
  `audit_actor_type.'sync'`, `notification_kind.'sync_failed'` survive as
  annotated dead labels. Never write them.
- **Do not re-add a Stop hook** (`62fa8e5` → `9427490`): it blocked every turn.

## Open Questions / Blockers

- **Hosting decision** — blocks step 1, which blocks everything automatic.
- **Discord/Slack webhook URL** needed from Rayan.
- `~/Desktop/tavrenops-backups/pre-0009-*.sql` is the only copy of the
  `client_update` values dropped in Phase 1. Keep it somewhere safe.
