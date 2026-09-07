# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.
> **The plan is `docs/ROADMAP.md`.** This file is only "where we are right now".

## Goal

A strictly internal, Postgres-centred operations system: the web app writes to
PostgreSQL; reporting and the one-way mirrors read from it.

## Branch topology — read this first

`main`, everything merged into it — `sales-ops` is fully contained and can be
deleted. Pushed through `3569e12`; do not trust a count written here, run
`git rev-list --count origin/main..main`.

`pnpm verify` (441 unit) and `pnpm test:db` (224 fixture) green; build green at
`NODE_OPTIONS=--max-old-space-size=4096`. **Do not build while `next dev` runs.**

⚠️ **Up to six Claude sessions run against this repo at once.** Commit with
`git commit --only -F <msgfile> -- <explicit paths>`, never `git add -A` (a new
file needs an explicit `git add` first — `--only` cannot name an untracked one),
and take your own test database with `TEST_DB_NAME=<name>_test pnpm test:db`.
The name must end in `_test`; that suffix is what stops the harness truncating
somebody else's.

**`0026` is being written RIGHT NOW by another session** (rate-limit buckets,
uncommitted as of 2026-09-08). **Take `0027`.** Check with `git log --all
--diff-filter=A --name-only -- 'drizzle/*.sql'` AND `git status`, because an
uncommitted migration appears in neither the log nor a branch you can see. Four
collisions happened in one day this way.

## Current State — phases 1, 2A, 2B.1/2B.2, S done; Phase 5 is five of six

🔴 **The Vercel deploy is broken and the fix is committed but NOT SHIPPED.**
Every page hung on its `loading.tsx` skeleton. `npx vercel deploy --prod` is the
only outstanding action. `DATABASE_POOL_MAX` is already `3` in Vercel and takes
effect on that deploy; confirm from the cold-start line
`{"event":"process.started","poolMax":3}` — the only way to read it back — then
check a real page loads. `45a35e1` removed the sync worker's drain lock (see
dead ends), added `src/instrumentation.ts`, memoised `accessibleProjectIds` and
turned off sidebar prefetch; `3569e12` pinned `vercel.json` to `sin1`.

**Phase S — sales operations** (`0024`, `0025`) and, before it, invitations on
`0023`, the interface rebuilt against `DESIGN-STANDARD.md`, and the shell moved
into `src/app/(app)/layout.tsx`. Full reasoning in PROGRESS.md, 2026-09-07.

## Next Steps

1. **Deploy, then verify a page loads.** Above.
2. **Regenerate the snapshots.** `drizzle/meta/` has none for `0024`/`0025`,
   deliberately — the one generated on the branch predated `saved_views` and
   would make the next `db:generate` emit a spurious `CREATE TABLE`. Run
   `pnpm db:generate`, keep the JSON, **delete the `.sql` beside it**.
3. **Phase 5.7 — per-person money permissions**, in `docs/ROADMAP.md`. `can()`
   is *overloaded* rather than taking a third argument, so all 24
   `finance.view`/`rates.view` call sites stop typechecking until each passes an
   actor — the compiler finds them, not a grep. Read `src/lib/authz.ts` first.
4. **Login rate limiting** — IN PROGRESS in another session on `0026`. Then
   **2B.3 onward**, then 2C: pasting an Upwork posting to pre-fill a proposal
   must also fill connects and boost, or the ledger drifts from the first bid.

## What Failed / Dead Ends

- **A pool of ONE turns "reserve a connection" into a deadlock.**
  `pool_.reserve()` in the sync worker while `drain()` queried the same pool.
  Invisible locally, where `max` is 10. On Vercel it hung, Postgres cancelled
  the statement, the rejection killed the process — and since Next had already
  streamed the shell, every browser held a skeleton with **no error and no
  status code**. `responseStatusCode: 0` in `vercel logs --json` is that
  signature; the page code is never where to look. `pool_` is no longer
  exported, `src/instrumentation.ts` is the backstop.
- **A session-level advisory lock is not released through a pool — NOR through a
  transaction pooler.** `db.execute` takes any free connection, and pinning our
  own connection does not help either, because Supavisor hands each statement to
  whichever backend is free. There is no way to hold one from a serverless app
  behind a pooler. Use `pg_try_advisory_xact_lock` or `FOR UPDATE SKIP LOCKED`.
- **Compute was in `iad1`, database in `ap-southeast-1`** — ~230ms a round trip,
  and a page render is a chain of seven. **The corollary matters more:** now
  `sin1` puts them together, a saved round trip is worth ~2ms, so streaming the
  shell and folding the layout's four queries are real optimisations not worth
  doing while that holds. `docs/DEPLOY-VERCEL-SUPABASE.md`.
- **`<Link>` prefetches by default**, and each prefetch renders the whole shell
  layout. Ten rail entries was ~50 round trips per page view for navigation that
  mostly does not happen.
- **THE PATTERN worth checking first: one rule, two implementations, drifting
  units.** The chase cutoff was calendar days in SQL and business hours in TS,
  so the rail badge, the chase list and each row's own column disagreed across a
  weekend. Four of ten defects in one pass had this shape.
- **`notify()` cannot overwrite a row already holding its dedupe key** — the
  upsert clears a snooze, not `resolved_at`, so five alerts were one-shot. A
  chase cycle carries `:<chaseCount>`; a recurring condition passes `reopen`.
- Standing traps, each of which cost an hour once, now in
  `.claude/handoff-history/TRAPS.md`: drizzle-kit's timestamp-order migrations
  and what `generate` does not model · RLS-forced tables and empty `inArray` ·
  correlated subqueries that render unqualified · `"use server"` exports as
  endpoints · `::float` on money.
- Older traps — `sql<Date>`, unchecked checkboxes, `overflow-x-auto` and sticky,
  callback refs, `afterAll(owner.end)` inside a describe, the grid, CDP, Drive
  and shadcn — are in `.claude/handoff-history/`.

## Open Questions / Blockers

- **Dev still has the nine shared-password accounts** (seed fix is forward-only).
- **`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` unset**, so the Google button is
  hidden. Needs a Google OAuth *Web application* client, NOT the Sheets service
  account already in `.env.local`.
- **Hosting** — Phase 6, explicitly last by the owner's instruction, though the
  Vercel/Supabase test environment is now documented and running.
- **`CONNECTS_FLOOR` is a constant** (`/settings`, Phase 5); seeded logs carry no
  revisions or costs; the digest webhook URL is unset.
