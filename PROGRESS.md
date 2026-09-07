# PROGRESS

Append-only log. **Newest entry at the top. Never edit or delete past entries.**

---

### 2026-09-07 (merge) — Six sessions' work becomes one branch

Rayan asked for everything merged into `main` and pushed. Four sessions were
live on this repo at the time, so the merge was mostly coordination.

- **Asked before touching anything.** The primary checkout had five dirty
  files. Three sessions confirmed they were not theirs; the fourth said Rayan
  had explicitly told them to leave those files uncommitted and went to check
  with him rather than take a peer's word for it. That was the right call and
  it cost twenty minutes, against the alternative of committing somebody else's
  in-progress deploy config.
- **The journal was a UNION, not a side.** `sales-ops` was cut before
  `0021_saved_views` and `0022_session_version` landed, so taking either
  version of `_journal.json` wholesale would have dropped two migrations from
  every database built from the repo. Caught by a peer comparing both journals
  directly rather than reading one.
- **Fourth migration-number collision of the day.** `main` took `0023` for
  invitations at a later timestamp than either of the branch's two. Leaving
  them would have worked on a fresh database and silently skipped them on any
  database that had invitations and not them — including a first deploy
  restored from a dev dump. Renumbered to `0024`/`0025`, timestamps moved past
  invitations, and the applied rows repaired in all three databases.
- **The prediction that paid off.** Migration `0011` deleted a follow-up
  chaser; `009fe46` then fenced its notification kind behind a type so nothing
  could emit it. This branch revives the chase, so `notify()` stopped
  compiling on merge — which was written into the roadmap weeks earlier as the
  thing that would happen. `followup_due` came off the exclusion list; the
  other two are still dead.
- **The snapshot chain had been broken since 0022.** `db:generate` was
  re-emitting the DDL of three applied migrations, so the next person to run it
  would have been handed a migration recreating existing tables. Regenerated to
  `0025`; `db:generate` now says "nothing to migrate".
- **Corrected a blocker that was not one.** Two applied migrations matching no
  file had been recorded as ledger drift — "a session generated, applied and
  deleted them". They were this branch's, one branch away. Withdrawn.
- **Proof, not assertion:** a database created from nothing and migrated from
  the merged journal passes all 224 fixture tests. 441 unit tests green.
- **The push is BLOCKED** by this session's permission settings and was not
  attempted a second way. 69 commits are merged and verified on `main`,
  unpushed. Asking a peer session to push would have laundered the permission
  decision, so it goes back to Rayan.

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
### 2026-09-07 — The redesign, and a way in that is not a pasted password

- **Shipped:** A full visual and navigational rebuild of the app against
  `DESIGN-STANDARD.md`, then Phase 5.8 — invitations — on migration `0023`.
  411 unit + 160 fixture tests, build clean.

- **The complaint was "boring", and the fix was not decoration.** The audit
  scored the build 35/92 against the standard's rubric; the redesign took it to
  roughly 60. What moved it was mostly subtraction: 285 contrast failures of
  1014 nodes to 0, 218 `ease-in-out` transitions to 13, ten font sizes to five,
  six weights to four. Excitement in an operations tool is the screen answering
  fast and reading clean, not motion — the standard's own frequency rule says a
  surface touched 100+ times a day gets no animation at all.

- **Contrast ramps were rewritten against the WORST surface each token can land
  on**, not against white. A token that passes on the page background and fails
  on a raised card is a token that fails, and the ratios are not rounded up:
  `--color-warn` moved because 4.489:1 is not 4.5:1. `--color-brand` moved from
  `#fb0044` to `#e8003f` because white 14px labels on it measured 4.05:1.

- **"The whole side reloads" was a real structural bug, not a perception.** All
  13 pages each rendered their own `<AppShell>`, so every navigation rebuilt the
  frame and re-ran the auth check, the user lookup and the unresolved count
  thirteen times over. They now live in `src/app/(app)/layout.tsx` — a route
  group, so no URL changed — and run once per navigation. The breadcrumb had to
  become a client component reading `usePathname()`, because a layout cannot
  take props from its children.

- **Sticky table headers had been silently doing nothing.** `overflow-x-auto`
  forces `overflow-y: auto`, which makes that wrapper the sticky containing
  block; measured, the header slid 1425px out of view. Fixed by making the
  container the vertical scroller — and deliberately NOT fixed on the work-log
  grid, where the change would move geometry the roving-tabindex model depends
  on. A correct fix in the wrong place is a regression.

- **The keyboard shortcuts came out.** Single letters (j/k/s) were built, then
  removed at the owner's word: they are only worth their discovery cost on a
  surface used all day by people who were told they exist. ⌘K stayed, because a
  command palette is discoverable by convention.

- **"Slipping" showed a task that was not slipping.** `streamOf()` fell back to
  `"slipping"` for 8 of 15 notification kinds it did not list, including
  `task_assigned`. The fix was not the missing cases but the fallback:
  `Record<NotificationKind, StreamKey>` makes the compiler refuse an incomplete
  map. The same session's badge counted informational rows nobody can act on —
  4 against a queue of 1 — and now counts only actionable ones.

- **Creating somebody no longer mints a password.** The row is created with
  `password_hash NULL` and the admin gets a one-time link, seven days, shown
  once, stored as SHA-256. A link rather than an email because the app has no
  mail capability: adding one is a service and a monthly bill in exchange for
  saving a paste into the chat the team is already in.

- **Decisions + rationale:**
  - **The token is hashed but not bcrypted.** Bcrypt's cost exists to slow
    guessing a human-chosen secret; there is nothing to guess in 256 random
    bits, and paying that cost on a public page is a denial-of-service lever.
    Compared with `timingSafeEqual` behind a length check, since it throws on a
    mismatch and a bad row would then 500 a page anyone can reach.
  - **Reads live in `invite-queries.ts`, not the action module.** Every export
    of a `"use server"` file is a callable endpoint, and both reads take an
    argument deciding which row comes back — as actions they would be a way to
    probe the users table from outside.
  - **The invite is re-checked inside the UPDATE**, not trusted from the page
    that rendered the form, so two submits of one link cannot both win. It also
    bumps `session_version`: a link that reached the wrong inbox may already
    have been spent.
  - **Where Google is configured the link is optional.** `tavren.io` is a Zoho
    workspace and most of the team signs in with personal Gmail, so no domain
    rule can distinguish a colleague from anyone on earth. The admin choosing
    an address IS the authorisation; Google only proves who is at the keyboard.
  - **`authorize()` keeps a dummy bcrypt compare for the null-hash case.** An
    early return would make a Google-only account answer measurably faster than
    a real one — an account-enumeration oracle bought for one saved hash.
  - **Reset password stays, and is a different control.** An invite is for
    arriving; a reset is for being locked out. A row offers one or the other,
    never both, so the admin never has to reason about which applies.
  - **No billable/Stripe concept.** Stripe does not operate in Pakistan and
    payment goes through Wise, which the owner does not want integrated. The
    reconciliation strip therefore reconciles against
    `projects.invoiced_through` and states its date basis on screen, rather than
    inventing a billing model the business does not have.

- **Found while working, worth remembering:** a hand-written migration is
  invisible until it is registered in `_journal.json` — `db:migrate` reported
  success and `0023` had never run. Migrations `0016`/`0017` had no drizzle
  snapshots, so `db:generate` emitted a migration re-dropping already-dropped
  columns, and `0017` had never actually run locally despite a handoff claiming
  it "runs on deploy". The migration ledger still holds two applied rows
  matching no file; that is on HANDOFF.md as a blocker to audit before deploy.

---

### 2026-09-05 (later) — Hardening, four items of six

- **Shipped:** Phase 5 items 1, 2, 3, 5 and 6 of `docs/ROADMAP.md`. One
  migration, `0022_session_version`. 399 unit + 160 fixture tests, build clean.

- **Nine accounts stopped sharing one password.** `tavren123` was on every
  seeded account, in the README, and on HANDOFF's blocker list since before the
  money layer existed. Each account now gets its own generated password, printed
  once and stored nowhere. The seed also refuses to run against a database that
  already has users — a check on the DATA rather than on `NODE_ENV`, because the
  case a `NODE_ENV` guard is least able to catch is exactly the dangerous one: a
  mistyped `.env.local` pointing at something real.

- **Deactivating somebody now takes effect on their next request**, not up to
  twelve hours later. `users.session_version` is compared for EQUALITY rather
  than ordering, so a replayed token claiming a higher version fails exactly as
  a stale one does and there is no clock skew to reason about. It bumps on
  reactivation too — the version is a revocation counter, not a state flag, and
  skipping that would let a pre-deactivation token work again afterwards.

- **The check had nowhere to live, and that was the same problem as the
  duplication.** Thirteen pages each repeated `getActor()` → re-fetch the row for
  the role → `can()` → `notFound()`. `src/lib/authz.ts` does it once, so the
  three revocation conditions ride along in a query every one of those pages
  already made. Wrapped in React's `cache()`, not `unstable_cache`: the former
  deduplicates within one render pass, the latter persists across requests,
  which for per-user authorisation data would mean one person's role answering
  another person's request.

- **Two failure modes were conflated and are now distinct.** Missing a
  CAPABILITY is a 404 — a non-admin should not learn an admin area exists.
  Having no valid SESSION is not a refusal at all, so it redirects to the login
  page; a 404 there tells somebody nothing about a thing they can fix in ten
  seconds. The proxy cannot catch that case: it sees a structurally valid JWT
  and lets the request through.

- **`/settings`** — there was no self-service anything, so a forgotten password
  meant an admin putting a temporary one into a chat message. Changing it
  requires the current password and ends every other session.

- **Two hazards worth more than the features:**
  - **`drizzle-kit migrate` applies in TIMESTAMP order and skips anything older
    than the newest applied row.** A concurrent session's migration silently
    strands yours — `db:migrate` reports success and the DDL never runs. It cost
    an hour of chasing 56 phantom test failures before the ledgers were compared.
  - **The dev database has two applied migrations matching no file in the
    journal.** A session generated, applied, then deleted them. The dev schema
    may contain changes no migration can reproduce. **Audit before deploying.**

- **Deliberately not done:** login rate limiting, the last Phase 5 item. It needs
  a table, and another session was mid-flight on migrations — starting one would
  have repeated the exact collision above. Agree a number first.

- **Still true:** the dev database still holds the nine shared-password rows.
  The fix applies to future seeds; those predate it and were not rotated.

---

### 2026-09-05 — The money layer, end to end

- **Shipped:** Phases 1 and 2A of `docs/ROADMAP.md`, plus 2B.1/2B.2, an in-app
  scheduler and Google sign-in. Migrations `0019` commercial foundation, `0020`
  job_runs, `0021` saved_views — all hand-written, all diffed against the live
  database before applying. 387 unit + 153 fixture tests, build clean.

- **Why the roadmap says what it says.** It was written after studying Toggl,
  Toggl Track, Plane and Harvest against their pricing tiers. The finding that
  shaped everything: **Tavren had premium-tier engineering under a free-tier
  feature set.** Append-only audit logs are Harvest Enterprise; retroactive
  rates are Toggl Premium; nobody offers revision chains at all. Meanwhile a
  clients directory, expenses, a billable split and budget-vs-spent on the
  project list are free everywhere and were missing here. Nobody can see an RLS
  policy; everyone can see that the project list has no money on it.

- **What the system can do that it could not.** Every logged hour knows whether
  it bills and what it cost. Billability is INHERITED from the kind of work
  (`task_types`), never asked per entry — `quick-log.tsx` states the constraint
  itself: it is used on a phone at 1am, and an unlogged hour is unrecoverable
  where a wrongly-flagged one is one click. Retainers are expressible for the
  first time. Rates, billing models and retainer periods all have writers; none
  of them did.

- **Decisions worth keeping:**
  - **`work_log_costs` is its own RLS-forced table.** Columns on `work_logs`
    would have retired the finance backstop overnight, silently, with every
    test still passing — that table is read by the grid, both CSV exports and
    `reports.ts::timesheet`, none of which open the gate. `rls.test.ts` now
    asserts `work_logs` has no `%cost%`/`%rate%` column.
  - **Rate changes are new rows, never updates**, closing the old row on the
    same date the new one opens. A day's gap makes hours `unrated`; a day's
    overlap makes them `ambiguous`. Both fail quietly, so it is a tested pure
    function rather than three lines in an action.
  - **No amounts in audit rows.** `head` holds `audit.view` but not
    `rates.view`, so an amount written there is readable by exactly the role
    `rbac.ts` withholds pay data from.
  - **The single-contributor rule**, enforced in SQL on all three money screens:
    a cost over one person's hours IS that person's rate.
  - **"Not costed" as an honesty cell** everywhere money appears. Without it the
    figures beside it read as complete when they omit everyone unrated.
  - **The browser is a clock source and nothing else.** The heartbeat names no
    job and sends no timestamp; the server decides from `job_runs`, so five open
    laptops produce one run an hour. This removed the "hosting blocks
    automation" chain that had headed HANDOFF's blockers for weeks.
  - **A saved view is a saved link** — cheap only because every list keeps its
    filters in the query string. Path allow-listed, so it cannot become an open
    redirect.

- **Bugs found by running things rather than trusting them.** Every one of these
  failed silently, which is the reason they are worth recording:
  - A correlated subquery interpolating `${projects.id}` renders the column
    UNQUALIFIED, so Postgres resolved it against the inner aliased table:
    `w.project_id = "id"` compared a work log to its own id, matched nothing and
    returned 0. The client detail reported 0.00h against a project with 113.61h.
  - `costEntry` was off by 100 — hundredths-of-an-hour times cents-per-hour is
    cents times 100, not 10000. Caught by its own tests before anything used it.
  - The rate lookup bounded `effective_from <= work_date` in SQL, comparing
    instants, while `resolveRate` compares UTC days. A rate created at 14:32
    excluded work logged at 12:00 the same day. Two implementations of one rule,
    and the stricter one won quietly.
  - `backfill-costs` never re-costed `unrated` rows, so its own closing advice
    — "enter the missing rates, then run this again" — did nothing.
  - A `NOT EXISTS` against an RLS-forced table from an ungated query sees zero
    rows and matches EVERYTHING; the "not costed" drill-down would have shown
    the whole timesheet.
  - `viewsFor(path, userId)` in a `"use server"` module would have let any
    caller read another user's saved views. Every export of one is an endpoint.
  - A `finally` resetting the finance GUC masks the real error on a SQL failure.

- **Found by Rayan driving the real form:** `platformFeePct` accepted 123, which
  passed the regex and made net contract negative. Capped at 100.

- **Still true and still blocking real use:** nine seed accounts share
  `tavren123`, there is no login rate limiting, and deactivating somebody leaves
  them signed in for up to 12 hours. That is Phase 5, and it is the gate before
  the agency touches this — not more features.
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
