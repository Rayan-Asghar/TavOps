# PROGRESS

Append-only log. **Newest entry at the top. Never edit or delete past entries.**

---

### 2026-09-07 (second bug pass) — One rule, implemented twice

The first pass asked what happens the second time a condition occurs. This
one asked where a rule is written down more than once, and found four more.

- **The chase cutoff was calendar days in SQL and business hours in
  TypeScript.** Any window containing a weekend made them disagree, and three
  readers then said three different things: the rail badge counted four, the
  chase list showed four rows, and each row's own Cold-for column said it was
  not due yet. Only the sweep, which re-derives per row, was right. The
  cutoffs are now computed once with `addBusinessHours` and handed to SQL as
  three fixed timestamps — one per status, so it stays a comparison the index
  can serve, and the two sides cannot drift.
- **The connects runway was per calendar day and labelled per working day.**
  Ten calendar days hold about seven working days, so the burn came out a
  third low and the runway a quarter long — on the one number somebody would
  plan a week of bidding against. Measured: 132 days claimed where 106 was the
  ceiling. The window is now a fortnight, which is what "two working weeks"
  means, and the divisor is the working days inside it.
- **A money sum went through a double**, which the roadmap forbids in as many
  words. The other float casts in reports.ts are hours, which the rule allows.
- **A tile labelled Connects reported meetings** when there was no burn rate,
  and **a lost deal kept its won value**, so the pipeline showed the old figure
  in the Value column of a row badged Lost.
- **`proposal-actions.test.ts` is new.** The write path had no fixture coverage
  at all, which is how the last of those survived review. It now covers losing
  and reviving a deal, the field-level refusal, the audit row, and that a rep
  cannot chase somebody else's proposal.
- Every fix was checked against the old code first and fails there. Ten defects
  across the two passes, six of them in code that had shipped weeks ago.
- 406 unit + 208 fixture tests, green on repeat. **Nothing merged to `main`.**

---

### 2026-09-07 (bug pass) — Five alerts that could only fire once

Asked what happens the SECOND time each condition occurs. The answer, five
times over, was "nothing".

- **The mechanism.** `notify()` upserts on (user_id, dedupe_key) and on
  conflict clears a snooze and nothing else — not the title, not `resolved_at`.
  So any row already on a key permanently shadows what a sweep tries to write
  there. That much was already known: it is why `0023` deletes the rows the
  `0011` feature left behind. What was missed is that RESOLVING a row creates
  exactly the same obstruction — and `resolveNotification` is the inbox's
  Dismiss button.
- **Consequences.** The chase queue would have gone silent after the first
  chase on every proposal. The connects alert would have warned the first time
  the team ran out and never again. And three sweeps that have shipped for
  months — stale tasks, project health, estimate overruns — stopped talking to
  anyone who had dismissed them once: dismiss "project at risk", it recovers,
  it slips again, silence.
- **Two fixes, and the difference is the point.** A chase cycle is a NEW ask,
  so its key carries the cycle number and the resolved rows stay as the history
  `chase_count` already claims to keep. The other four are ONE condition
  recurring, so `notify()` gained an opt-in `reopen` that clears `resolved_at`
  and refreshes the wording — but only on a closed or snoozed row, because an
  unconditional refresh would rewrite `created_at` on every hourly sweep and
  reshuffle the inbox. Both halves are tested; the second one is the obvious
  implementation and it is wrong.
- **The sync drain leaked its own lock.** `pg_try_advisory_lock` is
  session-level and `db` is a pool, so the unlock could land on a different
  connection and release nothing — after which every drain returns "another
  drain is running" and sheet syncing stops with nothing in the log. Recorded
  as a known hazard three handoffs ago and never fixed. Now taken and released
  on one reserved connection.
- **And a lesson about proving a fix.** The first version of that test asserted
  zero locks held, and passed and failed for reasons unrelated to the code:
  `pg_locks` is cluster-wide, so another test file's closing connection tripped
  it. The second version polled until zero — which passes against the BUGGY
  implementation, because a leaked lock disappears when the pool recycles. The
  honest version compares to a baseline and races eight drains, catches the old
  bug about half the time, and says so in the test rather than pretending
  otherwise. The previous commit message overclaimed and was corrected in the
  next one.
- 406 unit + 198 fixture tests, stable on repeat. Every route driven in a
  browser for a sales user and a head. **Nothing merged to `main`.**

---

### 2026-09-07 (later) — Connects, and what a shared database hides

Finished Phase S. S2 and S3 landed on top of the morning's S0/S1.

- **The connect ledger** (`0024`). One append-only signed table, not a
  purchases table plus a `connects_spent` column: Upwork also grants, refunds,
  expires and charges to boost, and under the two-table shape each of those
  becomes another column — a ledger, assembled badly, one emergency at a time.
  A spend column would also be a second copy of a fact, the same decision that
  keeps `work_log_costs` off `work_logs`.
- **What it refuses to answer.** Acquisition cost. Pricing a spend needs a
  costing basis, and a basis chosen for a report is a number somebody prices a
  hiring decision off. Money lives on `purchase` rows and that is a CHECK, not
  a convention — six CHECKs in total, none of which `drizzle-kit` models.
- **Drift is the design.** `reconcile` is a first-class kind with a required
  note, so the difference between us and Upwork becomes a row rather than a
  silent correction, and "last reconciled 12 days ago (was 8 short)" sits
  beside the balance.
- **Not a blocker**, and structurally so: `blockers.project_id` is NOT NULL and
  running out of connects belongs to no project. `usersWithCapability` says
  "whoever buys connects" without inventing a fourth OwnerKind.
- **S3** surfaced the client-side blockers `resolveBlockerRouting` had always
  been sending to the deal owner — that half of the model had never had a
  screen — and narrowed the blocker form's category groups for a reporter whose
  only standing on a project is that they sold it.
- **The lesson of the day was infrastructure, not code.** `pnpm test:db` was
  returning 11–53 failures across ten files, a different set every run, with
  foreign-key violations against rows that should have existed. It read exactly
  like a race in the code under test. It was another worktree running its own
  fixtures against the same `tavren_ops_test`. Proved by sampling
  `pg_stat_activity` mid-run and seeing two TRUNCATE statements from two
  different table lists. `TEST_DB_NAME` now gives a branch its own database.
- **And one silent failure worth remembering.** `drizzle-kit migrate` printed
  "applied successfully" and applied nothing, because another session had
  journalled a migration 80 seconds later than ours and drizzle only applies
  what is newer than the last applied. Three number collisions in one day; the
  fix is to serialise migration work, not to be quicker.
- 406 unit + 188 fixture tests green. **Nothing merged to `main`.**

---

### 2026-09-07 — Sales gets a job to do, on branch `sales-ops`

The prompt was a former salesperson's own verdict: the sales role in Tavren
"isn't doing much", the only useful thing is logging proposals, and half of what
a rep is shown — timesheets, logging work — belongs to somebody else. Two
different problems, and separating them was most of the work.

- **The pipeline was a filing cabinet.** It recorded that a bid went out and how
  it ended, and nothing about the job in between, which is chasing. A bid sent an
  hour ago and one sent twelve days ago rendered identically, in a list capped at
  sixty rows with no filter, no search and no detail page. Losing taught nothing.
- **Shipped S0:** `worklog.create` off the sales role, which removes `/log` and
  `/timesheet` from the rail *and* the command palette in one edit. That exposed
  a pre-existing hole rather than creating one — neither page had a capability
  gate, only an auth check, so both were reachable by URL rendering forms whose
  every action throws. `/reports` was **narrowed, not withheld**: for a rep it is
  not a timesheet, it is project-scoped and already answers "how many hours went
  into what I sold". Landing became `/start`, a route rather than a branch,
  because `signIn("google")` is called before anyone knows who is signing in.
- **Shipped S1:** the chase. Migration `0022`, `lib/chase.ts`, a sixth sweep,
  real pagination, `/sales/[id]`, lost reasons, client linking.
- **The distinction that justifies the feature:** `0011` deleted a follow-up
  chaser because it asked a rep to name a date and then nagged them about the
  date they named. This asks for nothing — due-ness is derived from the status
  and the clock, so a rep who never touches it still gets a correct queue. There
  is a test asserting the signature takes no caller-supplied date, because the
  easy way to undo that is an optional parameter "just for one case".
- **The bug worth remembering.** The sweep reported flagging nine follow-ups and
  wrote nothing. The deleted `0011` feature used the same notification kind *and*
  the same dedupe key, and its rows were never resolved — nine had sat unread in
  three inboxes since August. `notify()` upserts on `(user_id, dedupe_key)` and
  on conflict only clears a snooze, so every old row permanently shadowed the new
  one: correct from the server, dead on the screen. **No test would have caught
  it, because no test starts from four weeks of production inbox.** Driving the
  real app found it, which is now the fourth time that has been true here.
- **Two collisions from six sessions sharing one repo.** Another session took
  `0021` for `saved_views` while this branch was writing `0021` for the pipeline
  — renumbered to `0022`. And `pkill -f "next dev"` killed that session's dev
  server; it was restarted, but the lesson is to match on the directory.
- **Not built:** S2, the connects ledger. Fully designed in `docs/ROADMAP.md`
  §S.2 — one append-only signed ledger, money on purchase rows only so that
  refusing acquisition-cost attribution is structural rather than a matter of
  discipline, and `reconcile` as a first-class kind because drift from Upwork is
  guaranteed and hiding it turns the balance into fiction.
- 396 unit + 158 fixture tests green. **Nothing merged to `main`.**

---

### 2026-09-03 — A spreadsheet inside the app

- **Shipped, UNCOMMITTED:** `/timesheet`, an editable grid over `work_logs` —
  one project × one month with a person filter, keyboard editing, block
  copy/paste, a live timer row and CSV export. 273 unit + 100 fixture tests,
  build clean. Driven in a real browser, not only in tests.

- **Why it exists:** an executive asked for the Google Sheets *experience* in
  the app. The mirror shipped a week earlier is push-only and
  `sheet-panel.tsx` says so outright — edits made in the sheet are never read
  back, so anyone fixing their hours in Google watched Tavren overwrite them.
  A grid whose cells *are* rows closes that without a two-way sync.

- **Four live bugs found underneath the feature**, none introduced by it. Worth
  more than the feature:
  - `nextVersion` was an unlocked `max(version)+1`; two concurrent corrections
    to one entry collided on `worklog_revisions_version_unique`. Now
    `FOR UPDATE OF work_logs`. The `OF` is load-bearing — without it the lock
    covers the joined `projects` row and every edit on the project serialises.
  - `loadForCorrection` read on a different connection than the write, so the
    invoiced and already-removed checks were check-then-act.
  - `adjustTimer` had no status guard: it resurrected a completed session as
    `paused`, and finishing it again wrote a second work log while overwriting
    `work_log_id`, orphaning the first.
  - No DB constraint on one open timer per person. Migration `0017`.

- **Decisions:**
  - **No Save button.** Every cell commits on leaving it, so there is never
    more than one uncommitted value. That is what reconciles a client grid with
    this app's rule that shareable UI state lives in the URL: project, person
    and month decide *what is fetched and who may see it* and stay in the query
    string; a half-typed "1.5" is neither, and stays in the client.
  - **One transaction, a SAVEPOINT per row.** In Postgres any statement error
    aborts the whole transaction, so "catch and continue" is only achievable
    with savepoints — per-row transactions would let a reader see half a paste.
    A rejected row takes its revision, audit row and sheet job with it.
  - **`reason` is optional for your own corrections, mandatory for somebody
    else's.** A grid that demands prose per cell produces "fix", "typo", "." —
    worse than nothing, because it looks like documentation. The correction
    form keeps its required reason.
  - **The row's verdict crosses the wire, never the user id.** On a page where
    `worklog.viewAll` may be false, sending `userId` would say who logged what.
    The client gets `editable`, a closed-set `lock` reason, and `isMine`.
  - **A pasted block carrying Work Log IDs is matched by id, not position** —
    the same argument `locateRow` makes for the sheet: somebody sorting rows
    invalidates every position at once, and the id survives it.

- **The sheet and the grid are not the same shape**, and this nearly shipped
  wrong. The sheet has six columns and no Person column; the grid renders
  Person third. A six-wide sheet block pasted positionally put *hours into the
  notes cell*. Found by driving a real paste, not by any test I had thought to
  write. A block the sheet's width, pasted at column A, is now read in the
  sheet's order.

- **Driving the real app caught what tests did not.** Two bugs only a browser
  showed: partial input into the blank row was discarded, and every new row
  appeared twice — `setRows` called inside a `setDraft` updater, which
  StrictMode invokes twice, doubling the hours in the totals. That last one is
  precisely the class of wrong number this grid exists to stop people writing
  down.

- **Closed a standing gap:** there were no tests for any work-log action at
  all. There are now 100 fixture tests, and the extraction into
  `work-log-writes.ts` was landed against characterisation tests written
  *first*, so the refactor is provably behaviour-preserving.

---

### 2026-09-03 — Google Sheets, back but inverted

- **Shipped:** a one-way work-log mirror, Tavren → Google Sheets, in the layout
  the team already keeps by hand. Six commits, `2a6f75e` → `a155744`.
  216 unit + 47 fixture tests.

- **This is not the sync deleted in 0009.** That one was client-facing, carried
  per-project column mapping, and addressed rows by number. This is internal,
  fixed-column, and addresses rows by the work log's uuid written into a hidden
  column — which is the fix for the corruption hazard the audit found in the old
  one.

- **The model was wrong twice before it was right**, and both corrections came
  from Rayan rather than from me:
  - Built per-project. Told it should be per person. Re-keyed.
  - Re-keyed again to person-per-project. Then: "who performed the task doesn't
    really matter, what matters is what and time" — which makes a per-person
    sheet a doubling of setup to record a distinction nobody reads off the
    sheet. Back to per-project, final.

  Worth keeping: the template itself was the evidence all along. It has no
  Developer column. I read the layout off it and did not read that.

- **Reading the real sheet changed the design more than any discussion did.**
  Header on row 8 under a banner and a live-formula totals strip, not row 1;
  a tab per month; columns that are the team's, with only four of six written
  by Tavren. Every assumption I had made about the layout was wrong, and the
  connect flow would have rejected their own sheet outright.

- **Decisions:**
  - **A delete blanks its row rather than removing it.** Removing shifts every
    row beneath and invalidates every recorded position at once. It also matches
    the domain: a work log is reversed, not erased.
  - **One id-column read per connection per drain**, and grouped append /
    batchUpdate. A 12-entry batch is one API call, asserted by test.
  - **`pg_try_advisory_lock` around the drain.** Every logged entry schedules
    one; ten people logging at once would otherwise mean ten reaper sweeps.
  - **`header_hash` per drain.** An inserted column would otherwise send Hours
    quietly into the Notes column, one row at a time, with nothing failing.
  - **`after()` bridges the missing scheduler** so a developer never waits on
    Google. A bridge, not a replacement — a lost drain leaves the job queued.

- **Three constraints established by testing, not by argument:**
  - The service account **cannot create Drive files** (403). This is why the app
    sends people to Google's `/copy` link and why the template is laid out in a
    sheet a person already owns.
  - The **Drive API is not enabled** on the Cloud project, so the "who else can
    edit this sheet" warning has never fired. It was written to degrade
    silently, which is exactly why nobody noticed.
  - **Renaming a spreadsheet does not need Drive** — `updateSpreadsheetProperties`
    is the Sheets API and the title is the Drive filename. Verified with a no-op
    rename that set the title to what it already was.

- **Not yet proven:** no sheet has been connected. The first allotment exercises
  the rename, the backfill and the first live write together.

---

### 2026-09-01 — Session close

Four commits: `63b510f`, `bac35be`, `a7bfdd6`, `e58fcea`. The five phases above
took the app from "built but not understood, with a client-facing sync that
contradicted the target" to internal-only, Postgres-centred, with reporting on
top. Net across `src`/`scripts`/`tests`: +2,877 / −2,823 over 58 files — roughly
flat in size, having removed a 1,100-line subsystem and added correction,
auditing, reporting and a fixture suite in its place.

Nothing was rebuilt. The domain model, the capability RBAC, the project scoping
and the RLS backstop were all sound and were left alone; the work was subtraction
plus the two things the schema had been prepared for but never got — correcting a
work log, and reading the hours back out.

**Still outstanding and unchanged since the start: nothing runs on a timer.**
Sweeps, digest and reports all work; no scheduler calls them. That is Phase 0
and it needs a hosting decision.

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
