# PROGRESS

Append-only log. **Newest entry at the top. Never edit or delete past entries.**

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
