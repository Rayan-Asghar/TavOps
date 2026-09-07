# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.
> **The plan is `docs/ROADMAP.md`.** This file is only "where we are right now".

## Goal

A strictly internal, Postgres-centred operations system: Web App → PostgreSQL
(single source of truth) → reporting and one-way mirrors. History in PROGRESS.md.

## Branch topology — read this first

`main`, well ahead of `origin/main` and **nothing is pushed**. Do not trust a
commit count written here; run `git rev-list --count origin/main..main`.

Tree clean as of this writing except another session's staged removal of
`ux-audit/` and `.claude/commands/uxaudit.md` — **leave that alone**; the
harness under `ux-audit/_harness/` is not part of it and still works.

`pnpm verify` (411 unit) and `pnpm test:db` (160 fixture) green, build green at
`NODE_OPTIONS=--max-old-space-size=4096`. **Do not build while `next dev` runs**,
and **do not run `pnpm test:db` while another session is** — both collide, the
second producing phantom failures against the shared test database.

⚠️ **Up to six Claude sessions run against this repo at once.** Commit with
`git commit --only -F <msgfile> -- <explicit paths>`, never `git add -A`. New
files need an explicit `git add` first — `--only` cannot name an untracked one.

**Migration `0023` is taken (invitations, applied). Take `0024`.**

## Current State

**Phases 1, 2A and 2B.1/2B.2 done; Phase 5 is five items of six.**

Phase 5.8 — invitations — landed this session (migration `0023`):

- **Creating somebody mints no password.** The row is created with
  `password_hash NULL` and the admin gets a one-time link valid seven days. A
  link, not an email: the app has no mail capability, and adding one is a
  service and a bill in exchange for saving a paste.
- **Where Google is configured the link is optional** — `maySignIn` passes the
  moment the row exists, because the admin choosing that address IS the
  authorisation. `/invite/[token]` offers both paths and says which.
  `sign-in-eligibility.test.ts` pins that an invite never gates Google.
- `src/lib/invite-token.ts` — 32 random bytes, base64url, stored SHA-256, shown
  once. Deliberately shares nothing with `password.ts`; both files say why.
- Reads live in `invite-queries.ts`, **not** the action module, because every
  export of a `"use server"` file is a callable endpoint.
- Reset password stays and is a *different* control: an invite is for arriving,
  a reset is for being locked out. A row offers one or the other, never both.

Earlier Phase 5 work — seed safety, `session_version`, `src/lib/authz.ts`,
`/settings`, dead notification kinds — is described in
`.claude/handoff-history/2026-09-07_pre-invitations.md`.

## Next Steps

1. **Phase 5.7 — per-person money permissions.** Fully specified in
   `docs/ROADMAP.md`. `can()` gets *overloaded* rather than taking a third
   argument, so all 24 `finance.view` / `rates.view` call sites stop
   typechecking until each passes an actor — the compiler finds them, not a
   grep. Overlaps `src/lib/authz.ts`; read that first.
2. **Login rate limiting** — the last Phase 5 item. Needs a table; take `0024`.
3. **Audit the migration ledger before deploying** — see the blocker below.
4. **Phase 2B.3 onward** — filter chips + grouping as one system (client
   grouping on `/projects` was deferred to land there), then view switchers,
   table conventions, global search over content.

## What Failed / Dead Ends

- **A hand-written migration is invisible until it is in `_journal.json`.** The
  migrator reads that file, not the directory: `db:migrate` reported success and
  the DDL never ran. Add the entry (`idx`, `version`, `when`, `tag`) by hand.
- **`drizzle-kit migrate` applies in TIMESTAMP order and skips anything older
  than the newest applied row**, so a concurrent session's migration silently
  strands yours. Symptom is a column in one database and missing in another.
- **A correlated subquery must not interpolate `${table.column}`** — drizzle
  renders it unqualified and Postgres resolves it against the inner table.
  Returns 0 with no error. Write `projects.id` longhand.
- **`sql<Date>` is a claim, not a conversion.** Use `gt()` / `lte()`.
- **`notFound()` mid-stream still returns HTTP 200.** Assert on the body.
- **`work_log_costs` must never become columns on `work_logs`** —
  `tests/db/rls.test.ts` asserts it.
- **An RLS-forced table cannot be filtered from an ungated query** — `NOT EXISTS`
  sees zero rows and matches EVERYTHING. Resolve ids in a gated query, and guard
  the empty list: `inArray(id, [])` is `IN ()` and matches everything too.
- **Every export of a `"use server"` module is a callable endpoint.**
- **A nullable `password_hash` changes timing.** `authorize()` keeps its dummy
  bcrypt compare for the null case deliberately — an early return would make a
  Google-only account answer faster than a real one, an enumeration oracle.
- **`vi.importActual("@/lib/auth")` breaks fixture tests** — use a plain factory.
- **`drizzle-kit generate` models neither RLS nor CHECK constraints.**
- **An unchecked HTML checkbox sends nothing** — use `readTriStateCheckbox`.
- **Do not reset the finance GUC in a `finally`**: the subtransaction is already
  aborted, so the reset masks the real error.
- **A session-level advisory lock belongs to a CONNECTION and `db` is a pool.**
  `scheduler.ts` uses the xact variant; **`sync-worker.ts:490` still has it.**
- **`pkill -f "next dev"` matches its own command chain.** Bracket the pattern.
- **`setState` in an effect is a lint error**; a `RefObject` effect cannot see a
  conditionally-mounted form — use a callback ref.
- Grid, CDP, Drive API and shadcn notes: `.claude/handoff-history/`.

## Open Questions / Blockers

- **MIGRATION LEDGER DRIFT — audit before deploying.** The dev database has two
  applied migrations, timestamps `1788796370256` and `1788796371256`, matching NO
  file in the journal: a session generated, applied, then deleted them. Dev may
  hold changes no migration reproduces. Diff dev against a clean migrate.
- **The dev database still has the nine shared-password accounts.** The seed fix
  applies to future seeds; those rows predate it and were never rotated.
- **`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are unset**, so the Google button is
  hidden and invitees can only set a password. They need a Google OAuth *Web
  application* client — NOT the Sheets service account already in `.env.local`.
- **Hosting** — Phase 6. Explicitly last, by the owner's instruction, and it no
  longer blocks automation.
- **Seeded logs carry no revisions or costs.**
- **Discord/Slack webhook URL** for the digest is still unset.
