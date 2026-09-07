# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.
> **The plan is `docs/ROADMAP.md`.** This file is only "where we are right now".

## Goal

A strictly internal, Postgres-centred operations system: Web App → PostgreSQL
(single source of truth) → reporting and one-way mirrors. History in PROGRESS.md.

## Branch topology — read this first

`main`, **41 commits ahead of `origin/main`. Nothing is pushed.**

Tree clean EXCEPT `docs/ROADMAP.md`, which **another session is editing right
now** — it is adding Phase 5.7 (per-person money permissions, overloading
`can()`) and 5.8 (invite by link). Leave it alone. **5.7 overlaps `src/lib/authz.ts`
directly; coordinate before both land.**

`pnpm verify` (399 unit) and `pnpm test:db` (160 fixture) green, build green at
`NODE_OPTIONS=--max-old-space-size=4096`. **Do not build while `next dev` runs**,
and **do not run `pnpm test:db` while another session is** — both collide, the
second producing dozens of phantom failures against the shared test database.

⚠️ **Up to six Claude sessions run against this repo at once.** Commit with
`git commit --only -F <msgfile> -- <explicit paths>`, never `git add -A`.
New files must be `git add`-ed by explicit path first.

## Current State

**Phases 1, 2A and 2B.1/2B.2 are done; Phase 5 is four items of six.**

Done this session (migration `0022` only):
- **Seed safety.** Each account gets its own generated password, printed once.
  The seed refuses to run against a database that already has users.
- **Session revocation.** `users.session_version`, bumped on deactivation,
  reactivation, password reset and self-service change.
- **`src/lib/authz.ts`.** `loadPageActor` / `requirePageActor` /
  `requireCapability` replaced the block 13 pages each repeated. Wrapped in
  React's `cache()`. The role is still read from the DB, never the token.
- **`/settings`** — name, password (requires the current one), theme, density.
- **Dead notification kinds** are unreachable via `EmittableKind`, not a migration.

## Next Steps

1. **Login rate limiting is the last Phase 5 item** and needs a table. It was
   deliberately NOT started: another session is mid-flight on migrations and a
   number collision is what broke the test database earlier today. Agree a
   migration number first, or wait for theirs to land.
2. **Audit the migration ledger before deploying** — see the blocker below.
3. **Phase 2B.3 onward** — filter chips + grouping as one system (client
   grouping on `/projects` was deferred to land there), then view switchers,
   table conventions, global search over content.
4. `/uxaudit` has NOT been re-run. The ~60/92 figure was scored by the session
   that did the work, so it is not evidence.

## What Failed / Dead Ends

- **`drizzle-kit migrate` applies in TIMESTAMP order and skips anything older
  than the newest applied row.** A concurrent session's migration therefore
  silently strands yours: `db:migrate` reports success and your DDL never runs.
  Symptom is a column missing in one database and present in another.
- **A correlated subquery must not interpolate `${table.column}`.** Drizzle
  renders it UNQUALIFIED, so Postgres resolves it against the inner table.
  Returned 0 with no error. Write `projects.id` out longhand.
- **`sql<Date>` is a claim, not a conversion**, and a raw `sql` template binds a
  `Date` differently from drizzle's operators. Use `gt()`/`lte()`.
- **`notFound()` mid-stream still returns HTTP 200** — Next commits the status
  before the throw. Assert on the rendered body, not the status code.
- **`work_log_costs` must never become columns on `work_logs`.**
  `tests/db/rls.test.ts` asserts it.
- **An RLS-forced table cannot be filtered from an ungated query** — `NOT
  EXISTS` sees zero rows and matches EVERYTHING. Resolve ids in a gated query,
  and guard the empty list: `inArray(id, [])` is `IN ()` and matches everything.
- **Every export of a `"use server"` module is a callable endpoint.**
- **`vi.importActual("@/lib/auth")` breaks fixture tests** — it reaches
  next-auth, which reaches `next/server`. Use a plain factory.
- **`drizzle-kit generate` models neither RLS nor CHECK constraints.**
- **An unchecked HTML checkbox sends nothing** — use `readTriStateCheckbox`.
- **Do not reset the finance GUC in a `finally`**: the subtransaction is already
  aborted, so the reset masks the real error.
- **A session-level advisory lock belongs to a CONNECTION and `db` is a pool.**
  `scheduler.ts` uses the xact variant; **`sync-worker.ts:490` still has the hazard.**
- **`pkill -f "next dev"` matches its own command chain.** Bracket the pattern.
- **`setState` in an effect is a lint error**; a `RefObject` effect cannot see a
  conditionally-mounted form — use a callback ref.
- Grid, CDP, Drive API and shadcn notes: `.claude/handoff-history/`.

## Open Questions / Blockers

- **MIGRATION LEDGER DRIFT — audit before deploying.** The dev database has two
  applied migrations, timestamps `1788796370256` and `1788796371256`, matching
  NO file in the journal: a session generated, applied and then deleted them.
  The dev schema may therefore contain changes no migration can reproduce, so a
  fresh environment would not match it. Diff dev against a clean migrate.
- **The dev database still has the nine shared-password accounts.** The fix
  applies to future seeds; those rows predate it and were not rotated.
- **Hosting** — Phase 6, and no longer blocks automation.
- **Seeded logs carry no revisions or costs** (routing the seed through
  `recordWorkInTx` would break the staleness-sweep fixtures).
- **Discord/Slack webhook URL** for the digest is still unset.
