# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Full pre-2026-08-28 handoff (733 lines) archived at `.claude/handoff-history/2026-08-28_2048.md`.

## Goal

Harden TavrenOPS enough for the Tavren team's first real use: fix the client-data
leak, finish the half-done sheets migration, and make status arrive without asking.

## Current State

**All 7 planned phases are complete. 108 tests pass, build is green, app runs.**
Nothing is committed — 71 files sit uncommitted on `main`.

Working and verified end-to-end by driving the app in a real browser:
- **Internal notes can no longer reach client sheets.** Split into
  `internal_notes` / `client_update` at `src/db/schema.ts:452`; only the client
  line enters the sync payload (`src/server/record-work.ts:170`). Structural, not
  a filter — `internalNotes` appears nowhere in the sheets path.
- **Sheets runtime fully on `sheet_connections`**; `sheet_mappings` dropped by
  `drizzle/0008_drop_deprecated_sheets.sql` (applied; 13 work logs, 13 revisions
  preserved).
- **Queue is reliable**: stuck-job reaper `src/server/sync-worker.ts:63`,
  deterministic idempotency key, `held_until` honoured. All three proven against
  the live DB.
- **`/log`** — phone-first log screen (`src/app/log/page.tsx`), installable PWA.
- **Daily digest** → Discord/Slack webhooks (`src/server/digest.ts`,
  `src/server/webhooks.ts`, `src/app/api/cron/digest/route.ts`).
- **Estimate-overrun sweep** `src/server/sweeps.ts:265` — fires, dedupes, notifies
  assignee + PM.
- Blocker routing collapsed 13 branches → 3 owners (`src/lib/blocker-routing.ts`).
- Shift clock moved to 18:00–02:00 PKT = 13:00–21:00 UTC (`src/lib/business-time.ts:31`).

**Stopping point:** everything builds and runs; the app is live on
`http://localhost:3000`. Nothing committed. Next actor should commit first.

## Files Touched This Session

- **New logic**: `src/lib/logger.ts`, `src/lib/errors.ts`, `src/lib/digest-format.ts`,
  `src/server/action-errors.ts`, `src/server/digest.ts`, `src/server/webhooks.ts`,
  `src/server/capacity.ts`
- **New UI/routes**: `src/app/log/page.tsx`, `src/components/quick-log.tsx`,
  `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`,
  `src/app/manifest.ts`, `src/app/api/cron/digest/route.ts`
- **New tests** (7 files, 108 cases): `src/lib/*.test.ts`, `src/server/*.test.ts`
- **Rewritten**: `src/server/sync-worker.ts`, `src/server/record-work.ts`,
  `src/lib/blocker-routing.ts`, `src/server/sheet-queries.ts`
- **Migration**: `drizzle/0008_drop_deprecated_sheets.sql` (+ snapshot)
- **Docs/config**: `README.md`, `.env.example`, `package.json`,
  `scripts/bootstrap.sh`, `vitest.config.mts` (renamed from `.ts`)

## What Failed / Dead Ends

- **Correlated subqueries in the digest silently returned 0.** Drizzle only
  qualifies column names when the outer query has a join; without one,
  `${tasks.projectId} = ${projects.id}` renders as `"project_id" = "id"`, which
  resolves inside the subquery to `tasks.project_id = tasks.id` — never true, no
  error. Fixed with grouped aggregates (`src/server/digest.ts:64`). **I wrongly
  called this a pre-existing repo-wide bug first** — every other call site has a
  join and is fine.
- **A CDP browser harness reported a fake auth bug.** `document.querySelector(
  'form button[type=submit]')` grabbed the sidebar's *sign-out* form (earlier in
  the DOM), so submits logged the user out and landed on `/login`. Scope clicks
  to `[name=X].closest('form')`. Not an app bug.
- **Driving server actions via curl** — 404s. Extracting the `$ACTION_ID_` value
  from HTML doesn't reproduce React's dispatch. Use a real browser instead.
- **A Stop hook was tried before and reverted** (`62fa8e5` → `9427490`): it
  *blocked* every turn until HANDOFF.md was updated. Do not reintroduce one.
- **Did NOT drain the sync queue** — NW-001 points at a real client spreadsheet.

## Next Steps

1. **Commit the 71 uncommitted files** — nothing is saved yet.
2. **Pick a host and schedule cron**: `/api/cron/sync` 2–5 min, `/sweeps` hourly,
   `/digest` daily. Nothing automatic works until this exists. Vercel Hobby is out.
3. **Set `DIGEST_WEBHOOK_URLS`** or the digest builds and goes nowhere.
4. **Prove the live Google write** — drain one job to NW-001 and confirm the row
   (needs explicit go-ahead: it writes to a real client sheet).
5. **DB-fixture tests** for the RLS backstop and the 404-not-403 access paths —
   the only untested high-risk areas.

## Open Questions / Blockers

- **Hosting decision** — blocks step 2, which blocks everything automatic.
- **Discord/Slack webhook URL** needed from Rayan — blocks step 3.
- **Permission to write to the real NW-001 client sheet** — blocks step 4.
- `update` mode has never run through the worker against a live client template.
- Nine seed accounts still share `tavren123`; delete once real admins exist.
