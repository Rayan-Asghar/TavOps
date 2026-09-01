# PROGRESS

Append-only log. **Newest entry at the top. Never edit or delete past entries.**

---

### 2026-09-01 — Phases 3 and 5: cleanup, and tests for the parts that could not be tested

- **Shipped:** `audit_log.detail` retired, the project page split, and a fixture
  test suite against a real Postgres. 130 unit + 26 fixture tests, build green.
  `pnpm test:db` and `pnpm verify:all` are new.

- **Two audit findings from this session were WRONG. Both corrected:**
  - **`auth.config.ts`'s `authorized` callback is live, not dead.** Next.js 16
    renamed Middleware to Proxy, so the consumer is `src/proxy.ts` — grepping
    for `middleware.ts` found nothing and made it look like dead code. The plan
    said to delete it; doing so would have removed the default-deny route gate
    and left only per-page checks, making any page that forgot one public. The
    file now says so at the top.
  - **`notifications_dedupe_unique` is not the NULL-distinct trap** that made
    `sheet_connections_owner_unique` inert. `dedupe_key` is nullable and means
    "do not collapse this one"; NULLs being distinct is exactly what lets every
    un-keyed notification insert. "Fixing" it would have capped a person at one
    un-keyed notification for life. Documented in the schema.

  Worth recording as a pattern: both were *plan items* generated from a
  fast read of the codebase, and both would have caused regressions. Verify
  before deleting, especially when the evidence is an absence.

- **Decisions:**
  - **The `detail` migration backfills unconditionally**, though on this
    database the two remaining rows were already copied. A deploy from an older
    snapshot may not be, and dropping a column with unmigrated data in it is not
    recoverable.
  - **Fixture tests are a separate suite, not part of `pnpm verify`.** Keeping
    `pnpm test` runnable with nothing started is worth more than one command;
    `pnpm verify:all` runs both. `tests/db` had to be explicitly excluded from
    the default config, which collects all of `tests/**`.
  - **The harness refuses to truncate any database not ending in `_test`.**
    `resetDb` truncates everything, and one mistyped URL would empty the dev
    database between cases.
  - **The RLS suite asserts the precondition, not just the behaviour.** The dev
    owner `tavren` is a superuser with BYPASSRLS and ignores RLS even with
    FORCE — so "FORCE blocks the owner" is a false assertion (I wrote it, it
    failed, and it was the test that was wrong). What actually holds the
    backstop up is the app connecting as `tavren_app`, so the suite checks
    `rolsuper`/`rolbypassrls` on the live connection. A superuser connection
    string would otherwise turn the guard off with nothing failing.
  - **Split the project page only twice** — queries to `project-queries.ts`,
    activity to a component. 660 → 504 lines. Splitting further would have meant
    threading a dozen props per tab for a smaller file, which is not the same as
    simpler code.

---

### 2026-09-01 — Phase 4: reporting out of Postgres

- **Shipped:** `src/server/reports.ts`, `/reports`, and a CSV export at
  `/api/reports/timesheet`. 130 tests pass, build green. This is the half of the
  refactor that actually replaces the internal spreadsheets: the hours are
  already in Postgres because work is logged in the app, so a timesheet is a
  query rather than a document somebody maintains.

- **Verified against the live DB in a browser, not only by tests.** For August
  2026, the page, the CSV and direct SQL agree exactly: 33.05h across 12
  entries; per person 20.80 / 8.00 / 3.25 / 1.00; capacity 168.00h, which is 21
  August weekdays at 40/5 a day. As a developer: no per-person table, no budget
  column, and both the page and the CSV restricted to their own 7 entries
  summing 20.80.

- **Decisions:**
  - **CSV before any generated Google Sheet.** It opens in whatever the reader
    already uses, needs no credentials, no external service and no per-row state
    to keep in sync — which is the entire reason the sheets sync was removed.
    `googleapis` stays out until somebody actually asks for a generated Sheet.
  - **The export shares the page's scoping helpers rather than repeating them.**
    An export that can contain a row its requester could not see on screen is
    the obvious way this feature goes wrong, and duplicated scoping logic is how
    that happens.
  - **The report page narrows by capability instead of being withheld.** A
    developer sees their own hours against their own capacity — the question
    they ask about themselves — rather than a 404.
  - **The range lives in the URL.** A chosen window is shareable, and the CSV
    link is built from the same parsed range, so a report and its export cannot
    disagree about which days they cover.
  - **Capacity is spread over the window's working days**, from
    `weekly_capacity_hours`, so a part-time person is not measured against a
    full week and a fortnight is not compared to one.
  - **CSV cells beginning `=`, `+`, `-` or `@` are apostrophe-prefixed.** Work
    notes are free text and a spreadsheet executes those as formulas on open.

- **Corrected while building:** `parseRange` originally kept a valid end and
  defaulted the malformed one, then swapped them — producing a window matching
  neither the request nor the default. A report silently covering the wrong days
  is worse than one obviously covering this month, so a bad value now discards
  both ends. Caught by a test whose assertion I had written expecting the
  simpler behaviour.

- **Phase 3 (cleanup) deliberately skipped** in favour of this. It is hygiene;
  this is the reason for the project. Still outstanding — see HANDOFF.

---

### 2026-09-01 — Phase 2: work logs can finally be corrected

- **Shipped:** `editWorkLog` / `deleteWorkLog`, the `writeAudit` helper wired
  into the operational tables, and `/audit`. 102 tests pass, build green.
  Verified in a real browser against the live DB, not only by unit tests.

- **Why this first:** the schema had been built for corrections since the first
  migration — `deleted_at`, `is_reversal`, the version chain, and
  `projects.invoiced_through` — and none of it was reachable. `worklog_revisions`
  only ever held v1, and a mistyped 8h was permanent. It is the thing the team
  hits in week one.

- **Decisions:**
  - **A reason is mandatory on both edit and delete.** Follows the precedent
    `adjustTimer` already set. A revision chain that records what changed but
    never why answers the easy half of "what happened here".
  - **Delete is a reversal, not a removal.** hours 0 + `is_reversal`, and the
    row soft-deleted, so totals fall to the truth while the record of what was
    once claimed survives.
  - **`invoiced_through` is enforced on BOTH the old and new date.** Moving an
    entry out of a billed period rewrites that invoice as surely as changing its
    hours does.
  - **Own entries need no capability; other people's need `worklog.edit`**
    (new, admin + head). Authorship is checked before the capability, so a
    developer fixing their own typo needs no grant.
  - **`writeAudit` takes the caller's `tx`.** An audit row that can commit while
    its change rolls back is worse than no audit row — it asserts something
    happened that did not.
  - **Extracted `isInvoiced` to `src/lib/billing-lock.ts`.** A `"use server"`
    module may only export async functions, so a predicate cannot live there and
    still be testable. Same reason `business-time.ts` and `timer-utils.ts` exist.

- **Fixed while building:** four queries counted deleted hours — the project
  activity list and total, `projects/page.tsx`, and two subqueries in
  `review/page.tsx`. Harmless until now only because nothing could delete.

- **Dev data touched by the verification run**, on junk seed entries: one NW-001
  log corrected 21.00h → 1.75h, one NW-001 and one BL-002 log removed. Left as
  they are: the audit log is append-only, and reverting would make it contradict
  reality.

---

### 2026-09-01 — Audit, direction change, and Phase 1: the client sheet sync is gone

- **Context:** Direction changed. TavrenOPS is now **strictly internal** —
  Web App → PostgreSQL (single source of truth) → reporting. No client portals,
  client-facing sheets, billing or external access. Audited the whole repo first
  rather than rebuilding; full audit and 5-phase plan at
  `~/.claude/plans/can-you-explain-to-wiggly-canyon.md`.

- **Audit findings that shaped the plan:**
  - The app was **already on the target architecture** — no REST API, RSC and
    server actions straight onto Postgres, only 4 route handlers.
  - Authorization is the strongest part of the codebase (capability RBAC +
    project-role overlay + 404-not-403 scoping + RLS backstop). Left untouched.
  - Exactly one structural divergence: the sheets sync was client-facing *and*
    wired into the domain write transaction.
  - Nothing is scheduled — every automation is inert until a host with a
    scheduler exists. Unchanged by any refactor; it is Phase 0.

- **Shipped (Phase 1):** Removed the client sheet subsystem entirely.
  **−2,616 / +54 lines of source.** 21 tables → 17. `googleapis` dropped.
  `drizzle/0009_remove_client_sheets.sql` applied. 94 tests pass (was 108; the
  14 removed were sheet-helper tests), build green, sweeps and digest verified
  live over HTTP.

- **Decisions:**
  - **Removed the helpers and `googleapis` too, not just the sync.** Phase 4 may
    add a one-way sheet *export*; writing fresh helpers then is cheaper than
    carrying a dead dependency through every intervening change.
  - **Dropped `work_logs.client_update` with its data**, backed up first to
    `~/Desktop/tavrenops-backups/pre-0009-*.sql` outside the repo. The
    internal/client note split existed only to feed client sheets; keeping a
    second note field would have preserved the confusing UX with no consumer.
  - **Kept three dead enum values** (`change_source.'sheet'`,
    `audit_actor_type.'sync'`, `notification_kind.'sync_failed'`). Postgres
    cannot drop a value from an enum in use, and recreating the types across
    their columns costs more than three annotated labels.
  - **Re-pointed the project-role RBAC tests at `deadline.viewClient`** rather
    than deleting them — the sheet capabilities were the only thing those tests
    exercised, and the overlay mechanism still needs cover.

- **Found while auditing, not yet fixed:** work logs cannot be edited or deleted
  despite the schema being fully built for it (Phase 2); the audit log is
  written by 4 modules and read by none (Phase 2); `auth.config.ts`'s
  `authorized` callback never runs because no `middleware.ts` exists (Phase 3).

- **Abandoned:** a plan to add destination guards to the sheets config
  (duplicate-sheet detection, NULL-distinct index fix, tab-picker bug). Correct
  work, wrong direction — the whole subsystem was deleted instead.

---

### 2026-08-28 — Hardening pass: privacy fix, sheets migration, digest, phone logging

- **Shipped:**
  - Fixed a live data leak: work-log notes were being written into client
    spreadsheets. Split into `internal_notes` / `client_update`; only the client
    line can reach a sheet, and an entry with no client line queues nothing.
  - Finished the Phase 2 sheets migration. Whole runtime moved onto
    `sheet_connections`; `sheet_mappings` and the deprecated `sync_jobs` columns
    dropped in `drizzle/0008_drop_deprecated_sheets.sql`. All 13 work logs and 13
    revisions preserved through the migration.
  - Sync queue made reliable: stuck-job reaper, real idempotency keys, `held_until`
    honoured, 45s wall-clock budget, batched user lookups.
  - New `/log` phone-first screen + installable PWA manifest.
  - New daily digest (`/api/cron/digest`) fanning out to Discord/Slack webhooks.
  - New estimate-overrun sweep; folded into project health.
  - BD loop closed: delivered hours and effective $/hour per bid category.
  - Collapsed blocker routing from 13 branches to 3 owners; froze teams.
  - Added the first 108 tests, structured logging, and error boundaries — all three
    were previously zero.
  - Made `scripts/bootstrap.sh` idempotent so `pnpm db:reset` no longer breaks auth.

- **Decisions + rationale:**
  - **Split notes rather than filtering them.** `internal_notes` is referenced
    nowhere in the sheets path and `SHEET_FIELDS` offers no mapping for it, so no
    configuration can route it to Google. A filter could be misconfigured; absence
    cannot.
  - **Dropped `sheet_mappings` outright instead of dual-writing.** Nothing was in
    production, so a clean single model beat a migration window. Two live models
    was the single most dangerous thing in the repo.
  - **Kept severity-driven SLAs** (1h/4h/8h/16h) when collapsing routing, against
    the original plan. It is a four-entry lookup — never where the complexity was.
  - **One input surface, many output channels.** The team is split across Discord,
    WhatsApp, Slack and the room, so a bot per channel means three integrations to
    reach one team. Input converges on the phone; output fans out over webhooks.
  - **Grouped aggregates over correlated subqueries** in new query code. Drizzle
    only qualifies column names when the query has a join, so a correlated
    subquery without one silently returns 0. Grouping is immune and faster.
  - **Estimate overrun as the slip detector.** Every other detector needs someone
    to report something; hours are logged anyway to feed the client sheet, so this
    one is free. Included despite margin being out of scope for fixed-price work,
    because it serves "work slips, we find out late".
  - **Archived sheets connections instead of deleting.** Destroying the record of
    what a client was already sent loses the only evidence of what they were told.

---

### 2026-08-27 — Google Sheets connected and proven end to end

- **Shipped:** Live Sheets sync verified against a real spreadsheet (NW-001).
  Per-project sheet setup in the app (Sync tab). `sheets:doctor` and
  `sheets:attach` scripts. Phase 2 schema for connections, revisions and an
  append-only audit log (`58db212`). Fixed a project-page crash from the
  `sync_status` enum rename (`3d4b677`).
- **Decisions + rationale:**
  - One shared service account, access granted by sharing each sheet with it —
    simpler than per-head credentials, and the address is surfaced in the UI
    rather than buried in docs.
  - Update mode never overwrites unmapped columns: client sheets carry columns the
    client maintains, and wiping them is the kind of bug that costs a relationship.
  - Phase 2 landed as schema only; no code was pointed at it. That gap became the
    2026-08-28 migration.

---

### 2026-08-27 — Session tracking added, then reverted

- **Shipped:** `PROGRESS.md`, a HANDOFF snapshot and a `Stop` hook (`62fa8e5`),
  reverted the same day (`9427490`).
- **Decisions + rationale:** The Stop hook *blocked* the end of every turn whenever
  code changed without HANDOFF.md being updated. Nagging on every turn was worse
  than the problem it solved. The 2026-08-28 continuity system deliberately uses
  SessionStart and PreCompact hooks only — no Stop hook.
