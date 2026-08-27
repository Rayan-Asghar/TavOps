# PROGRESS

## Goal
*(inferred from README + code — please confirm)* Internal operations platform for
**Tavren**, a 10–15 person agency (Shopify/WordPress/automation/CRM). One system
for sales → delivery → reporting; a developer's single work update fans out to
task status, reviewer, inbox, and the client's Google Sheet.

**Current priority** *(inferred — please confirm)*: deploy + schedule the cron
endpoints. Nothing runs automatically today, so sync/escalation only fire when
someone curls them.

Long-form reasoning: `docs/ARCHITECTURE.md`. Original brief: `docs/tavOps.md`.

## Stack & entry points
| Layer | Where |
| --- | --- |
| Frontend | Next.js 16.3.3 App Router, `src/app/**`, Tailwind v4 `src/app/globals.css` |
| Server logic | `src/server/*.ts` (`"use server"` = actions; plain = reads) |
| Auth | Auth.js v5 JWT, `src/lib/auth.ts`, gate in `src/proxy.ts` |
| Authorisation | `src/lib/rbac.ts` (capabilities), `src/lib/access.ts` (project scope) |
| DB | Postgres 17 @ :5433 via `docker-compose.yml`; Drizzle `src/db/schema.ts` |
| Migrations | `drizzle/*.sql` (7, all applied) |
| Background jobs | `src/app/api/cron/{sync,sweeps}/route.ts` — **no scheduler yet** |
| Sheets sync | `src/server/sheets.ts`, `sync-worker.ts`, UI `src/components/sheet-config.tsx` |
| Infra/deploy | **none — localhost only** |

## Feature status
| Feature | Status | Verified by |
| --- | --- | --- |
| Auth & sessions | done | manual: login all 9 seed accounts |
| RBAC + project scoping (404 not 403) | done | manual: dev gets 404 on non-member project |
| Finance/rates RLS backstop | done | manual: psql as `tavren_app`, 0 rows without opt-in |
| Projects: create, activate, membership | done | manual: browser end-to-end |
| Tasks: create, assign, estimate, due | done | manual: Hozefa→Ayan, inbox item appeared |
| Time tracking (start/pause/resume/finish) | done | manual: 5h47m session → 5.78h work log |
| Blockers: 13 categories, rule routing, SLA | done | `scripts/routing-matrix.mjs` + manual QA-issue routed to project QA |
| Teams (many-to-many, overlap resolution) | done | manual: Ayan's 2 leads → picked the one on that project |
| QA review queue, revision rounds | done | manual: round 1 sent back, round 2 approved |
| Sales pipeline, feasibility, won→project handoff | done | manual: converted proposal → draft project AR-001 |
| Google Sheets sync (append mode) | done | manual: work log → queue → real spreadsheet row |
| Google Sheets sync (update mode) | in progress | **unverified against real Google** |
| Per-project sheet setup UI | done | manual: connected 2nd project via browser |
| Admin: users, roles, deactivate, audit | done | manual: created user, signed in, audit row written |
| Notifications (in-app inbox only) | done | manual: dedupe + resolve verified |
| Email / Slack / Discord delivery | not started | — |
| Onboarding | not started | — |
| Public API | not started | — |
| Deploy & monitoring | not started | — |

## Current state
- `pnpm lint` clean · `npx tsc --noEmit` clean · `pnpm build` succeeds, 13 routes.
- **No test suite exists** — no `test` script, no `*.test.ts`. All "verified by"
  above is manual browser + SQL checking.
- Postgres container healthy; seeded 9 users, 4 teams, 2 projects, 13 proposals.
- Deployed nowhere. Runs on `localhost:3000` only.
- Sheets connected for `NW-001` only (`sheet_mappings` has 1 row).

## In progress
Nothing half-written. Working tree clean at `d33a325`.

## Decisions
| Decision | Reason | Date |
| --- | --- | --- |
| 5 roles; `head` shared by Hozefa/Hammad/Muzammil | They run the company jointly; per-project role decides ownership | 2026-08-27 |
| Capability checks, never role-name checks | Adding a role stays a one-file edit | 2026-08-27 |
| App connects as `tavren_app` (NOSUPERUSER/NOBYPASSRLS) | A superuser silently bypasses the RLS backstop, `FORCE` included | 2026-08-27 |
| 404 not 403 on unauthorised project | 403 confirms existence → ids become enumerable | 2026-08-27 |
| Developers never see `client_due_date` | Seeing both dates destroys the internal buffer | 2026-08-27 |
| Timer elapsed derived from timestamps, never ticked | Survives closed laptop / restart | 2026-08-27 |
| One blocker owner + watchers, not broadcast | "Notify all managers" makes an inbox nobody reads | 2026-08-27 |
| QA decisions are rows in `reviews`, not a status flag | Revision-round count is the point of tracking QA | 2026-08-27 |
| Single-tenant, no billing | Internal tool for one agency; no multi-tenancy or subscriptions | 2026-08-27 |
| Reads live outside `"use server"` files | Every exported async fn there is a callable action | 2026-08-27 |

## Tried and rejected
- **Vercel Hobby for hosting** — ToS forbids commercial use; cron runs once/day, which kills escalation.
- **Supabase client-direct (RLS as only auth)** — would force RLS everywhere; chose a real API + app-layer RBAC.
- **RLS on all tables** — debugging cost outweighs benefit at 15 users; kept it on financials + rates only.
- **Composing `.btn` via Tailwind `@apply`** — v4 resolves utilities only; fails with `Cannot apply unknown utility class 'btn'`.
- **`Math.max()` over empty column map** — `-Infinity` → opaque `RangeError`; guarded.

## Known issues / blockers
1. **No automated tests.** Everything is manually verified; nothing protects a refactor.
2. **Nothing scheduled.** `/api/cron/sync` and `/api/cron/sweeps` need an external scheduler.
3. **`pnpm db:reset` breaks the app** — `scripts/bootstrap.sh` regenerates the `tavren_app` password and only prints it; `.env.local` goes stale. Use the TRUNCATE recipe in `docs/ARCHITECTURE.md` §7.
4. Sheets **update mode** never run through the worker against real Google.
5. Seed accounts share password `tavren123` — delete before real use.
6. No Postgres backups, no error monitoring.
7. `startTimer` assignee guard verified via UI, not against a forged direct request.
8. Env vars required (names only): `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `CRON_SECRET`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`.

## Next steps
1. **Deploy to a VPS with Docker.** Done when the app answers on a public HTTPS URL and `pnpm build` runs there.
2. **Schedule both cron endpoints** (`sync` 2–5 min, `sweeps` hourly) with the `CRON_SECRET` bearer. Done when a blocker escalates without anyone curling.
3. **Postgres backups** — nightly `pg_dump` to off-box storage. Done when a restore into a scratch DB succeeds.
4. **Delete seed accounts**, create real ones via `/admin/users`. Done when no account uses `tavren123`.
5. **Prove Sheets update mode** on a client template with `tasks.sheet_row_ref` set. Done when a row updates in place and unmapped columns survive.
6. **Add tests** — start with `src/lib/blocker-routing.ts` (already pure), then RLS and the 404 paths. Done when `pnpm test` runs in CI.
7. **Fix or delete `pnpm db:reset`** (issue 3). Done when it leaves a working `.env.local`.

## How to verify
```bash
docker compose up -d                 # Postgres :5433
pnpm install && pnpm dev             # http://localhost:3000
pnpm lint                            # must be silent
npx tsc --noEmit                     # must be silent
pnpm build                           # must reach "Compiled successfully"
npx tsx scripts/routing-matrix.mjs   # prints blocker routing table
pnpm sheets:doctor <sheetId> [tab]   # 7-check Google Sheets round-trip
curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/sweeps
```
No test suite yet — see Next steps 6. Manual walkthrough: `docs/ARCHITECTURE.md` §7.
