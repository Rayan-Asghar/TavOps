# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.
> **The plan is `docs/ROADMAP.md`.** This file is only "where we are right now".

## Goal

A strictly internal, Postgres-centred operations system: the web app writes to
PostgreSQL; reporting and the one-way mirrors read from it.

## Branch topology — read this first

`main`, well ahead of `origin/main` and **nothing is pushed**. Do not trust a
commit count written here; run `git rev-list --count origin/main..main`.

`ux-audit/` and `/uxaudit` were retired in `6f4023e` — snapshots of an interface
still moving; `ux-audit/_harness/` survives for driving a browser. `pnpm verify`
(411 unit) and `pnpm test:db` (160 fixture) green, build green at
`NODE_OPTIONS=--max-old-space-size=4096`. **Do not build while `next dev` runs**,
and **do not run `pnpm test:db` while another session is** — both collide.

⚠️ **Up to six Claude sessions run against this repo at once.** Commit with
`git commit --only -F <msgfile> -- <explicit paths>`, never `git add -A`; a new
file needs an explicit `git add` first, as `--only` cannot name an untracked one.

**Migration `0023` is taken (invitations, applied). Take `0024`.**

## Current State — phases 1, 2A, 2B.1/2B.2 done; Phase 5 is five of six

Phase 5.8 — invitations — landed this session on migration `0023`. Creating
somebody now mints no password: the row is `password_hash NULL` and the admin
hands over a one-time link (`src/lib/invite-token.ts`, seven days, stored
SHA-256). Where Google is configured that link is optional, because the admin
choosing an address IS the authorisation — `sign-in-eligibility.test.ts` pins
that an invite never gates Google. Reset password is a separate control for
being locked out; a row offers one or the other, never both.

Before that the interface was rebuilt against `DESIGN-STANDARD.md`, and the app
shell moved into `src/app/(app)/layout.tsx` — a route group, so no URL changed —
where the auth check runs once per navigation instead of thirteen times.
Reasoning for both is in PROGRESS.md, 2026-09-07; earlier Phase 5 work is in
`.claude/handoff-history/2026-09-07_pre-invitations.md`.

## Next Steps

1. **Phase 5.7 — per-person money permissions**, specified in `docs/ROADMAP.md`.
   `can()` gets *overloaded* rather than taking a third argument, so all 24
   `finance.view` / `rates.view` call sites stop typechecking until each passes
   an actor — the compiler finds them, not a grep. Read `src/lib/authz.ts` first.
2. **Login rate limiting** — the last Phase 5 item. Needs a table; take `0024`.
3. **Audit the migration ledger before deploying** — see the blocker below.
4. **Phase 2B.3 onward** — filter chips and grouping as one system (client
   grouping on `/projects` was deferred to land there), then view switchers.

## What Failed / Dead Ends

- **A hand-written migration is invisible until it is in `_journal.json`** — the
  migrator reads that file, not the directory, so `db:migrate` reports success
  and the DDL never runs. Add `idx`/`version`/`when`/`tag` by hand.
- **Migrations are ordered by `when`, and `idx` and the `NNNN_` prefix are only
  labels.** `pg-core/dialect.js:57-62` reads the single newest applied row and
  applies only entries whose `when` exceeds its `created_at`; the hash is sha256
  of the file's contents, so renaming a migration does not change it. A branch
  whose migration carries an older `when` than one already applied is therefore
  skipped in silence — which is what an applied row matching no file in THIS
  branch's journal means. Check the other branches before calling it an orphan.
  `generate` models neither RLS nor CHECK constraints.
- **A correlated subquery must not interpolate `${table.column}`** — drizzle
  renders it unqualified and it returns 0 with no error. Write it longhand.
- **An RLS-forced table cannot be filtered from an ungated query** — `NOT EXISTS`
  sees zero rows and matches EVERYTHING; so does `inArray(id, [])`, which is
  `IN ()`. Resolve ids in a gated query and guard the empty list. Never fold
  `work_log_costs` into `work_logs` (`tests/db/rls.test.ts` asserts it), and
  never reset the finance GUC in a `finally` — the reset masks the real error.
- **Every export of a `"use server"` module is a callable endpoint** — hence
  `invite-queries.ts`.
- **A nullable `password_hash` changes timing.** `authorize()` keeps its dummy
  bcrypt compare for the null case deliberately — an early return would make a
  Google-only account answer faster than a real one, an enumeration oracle.
- **`overflow-x-auto` forces `overflow-y: auto`**, so sticky headers inside one
  silently do nothing — fixed everywhere but the work-log grid, whose roving
  tabindex depends on the current geometry. And a layout cannot take props from
  its children: the breadcrumb derives from `usePathname()`.
- Shorter traps — `sql<Date>`, `notFound()` returning 200, unchecked checkboxes,
  `vi.importActual`, callback refs, the grid, CDP, Drive and shadcn — are in
  `.claude/handoff-history/`; read the most recent two before a related change.

## Open Questions / Blockers

- **Dev still has the nine shared-password accounts.** The seed fix applies to
  future seeds; those rows predate it and were never rotated.
- **`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are unset**, so the Google button is
  hidden and invitees can only set a password. They need a Google OAuth *Web
  application* client — NOT the Sheets service account already in `.env.local`.
- **Hosting** — Phase 6, explicitly last by the owner's instruction.
- **`sync-worker.ts:490` holds a SESSION-level advisory lock** while `db` is a
  pool, so it can release on a different connection than took it. `scheduler.ts`
  was moved to the xact variant; this one was not.
- **Seeded logs carry no revisions or costs**; the digest webhook URL is unset.
