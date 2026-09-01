# TavrenOPS

Internal operations for Tavren: projects, tasks, work logs, blockers, timers
and the automations that chase them. Strictly internal — Postgres is the single
source of truth, and anything leaving it is a report generated from it.

The design brief and full backlog live in [docs/tavOps.md](docs/tavOps.md).

## What v1 does

One developer submission fans out to everything else:

```
Log work  ->  work_logs row
          ->  worklog_revisions v1, so every entry has an origin
          ->  task status + freshness clock
          ->  reviewer notification
          ->  clears the "you owe an update" inbox item
```

Everything commits in one transaction: an entry cannot exist without its
revision, and a task status cannot move without the entry that moved it.

| Module | State |
| --- | --- |
| Auth + roles (5 roles, see below) | Working |
| Admin UI for creating / deactivating people | Working |
| Projects, scoped per user | Working |
| Tasks: create, assign, estimate, due dates | Working |
| Project creation (direct, for non-sales work) | Working |
| QA review queue: approve / send back, revision rounds | Working |
| Work logs, task-level and project-level | Working |
| Blockers: rule-based routing, severity SLAs, escalation | Working |
| Client deadline hidden from developers | Working |
| Needs-attention inbox with de-duplication | Working |
| Task timer: start / pause / resume / finish, auto work log | Working |
| Timer correction with mandatory reason + audit entry | Working |
| BD pipeline: proposals, feasibility routing, conversion by category | Working |
| Won proposal → draft project handoff | Working |
| Phone-first log screen (`/log`) + installable PWA | Working |
| Daily digest pushed to Discord / Slack webhooks | Working |
| Estimate-overrun detection | Working |
| Effective rate per bid category | Working |
| Correcting or removing a work log, with a reversal trail | Working |
| Audit log written by the operational tables, readable at `/audit` | Working |
| Reports: hours by project and person, timesheet, CSV export | Working |
| QA checklists, change requests, anything client-facing | Out of scope |

## Running it

```bash
docker compose up -d          # Postgres on :5433
cp .env.example .env.local    # then fill in the secrets below
pnpm db:migrate
bash scripts/bootstrap.sh     # creates the least-privilege app role
pnpm db:seed                  # the Tavren team + two sample projects
pnpm dev
```

Seeded accounts all use the password `tavren123` (development only).
Sign in as `hammad@tavren.io` for the PM view or `ayan@tavren.io` for a
developer's. Delete these before the app touches a real machine and create
real accounts through **People** in the nav.

### Tests

```bash
pnpm verify      # typecheck + lint + unit tests. No database needed.
pnpm test:db     # fixture tests against a real Postgres.
pnpm verify:all  # both.
```

`pnpm test:db` builds and migrates a separate `tavren_ops_test` database on the
same container, deriving both connection strings from `.env.local` with the name
swapped — there is no second set of credentials to keep in step. The harness
refuses to truncate any database whose name does not end in `_test`.

It covers the two things unit tests cannot reach: project scoping
(`canAccessProject` / `accessibleProjectIds`, including expiry and the
404-not-403 rule) and the finance RLS backstop — that `project_financials` and
`user_rates` return nothing outside `withFinanceAccess`, that the opt-in dies
with its transaction, and that the app connects as a role which cannot bypass
RLS. That last one is the precondition everything else rests on: a superuser
connection string silently turns the backstop off with nothing failing.

### Secrets

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Connects as `tavren_app`. Must NOT be a superuser — see below. |
| `MIGRATION_DATABASE_URL` | Owner role. Used only by drizzle-kit. |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | Guards `/api/cron/*`. `openssl rand -hex 24` |
| `DIGEST_WEBHOOK_URLS` | Comma-separated Discord/Slack incoming webhooks. Blank disables delivery. |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error`. Structured JSON on stdout. |
| `APP_DB_PASSWORD` | Optional. Pins the `tavren_app` password across `pnpm db:reset`. |

## Scheduled jobs

Two endpoints, both requiring `Authorization: Bearer $CRON_SECRET`:

| Endpoint | Cadence | Does |
| --- | --- | --- |
| `POST /api/cron/sweeps` | hourly | Escalates blockers, flags stale tasks and estimate overruns, recomputes project health |
| `POST /api/cron/digest` | daily, ~13:00 UTC | Builds the status digest and posts it to every configured webhook |

Add `?dry=1` to the digest endpoint to render it without sending — useful for
checking the wording without putting a test message in front of the team.

Note that Vercel's Hobby tier only runs cron **once per day** and forbids
commercial use, which makes it a poor fit. Use a cheap VPS, Cloudflare Workers
cron triggers, or any external scheduler hitting these URLs.

## Roles

| Role | Sees projects | Sees others' activity | Financials |
| --- | --- | --- | --- |
| `admin` | all | yes | yes, incl. pay rates |
| `head` | all | yes | yes, not pay rates |
| `sales` | theirs | own only | no |
| `developer` | assigned only | own only | no |
| `collaborator` | assigned only, expires | own only | no |

Hozefa, Hammad and Muzammil share **`head`**. Splitting them into PM /
delivery lead / sales head encoded a division of labour that does not hold —
they run the company jointly and each wears whichever hat a project needs.
What any one of them owns is decided by their role *on that project* and by
which team the person reporting it belongs to.

`rates.view` stays admin-only. The heads are partners and may well want it —
it is one line in `src/lib/rbac.ts` — but pay data is not granted by
inference.

## Teams

Teams are **reference only**. They once decided who a blocker escalated to,
resolved per-blocker by preferring the lead who was also on the project. That
machinery was removed: for a team of ten whose partners speak daily, it encoded
a hierarchy that does not exist and cost maintenance forever.

Blockers now route by **project role** — the sales owner, PM or delivery lead
named on that project. Editing a team changes nothing about routing, SLAs or
notifications. The tables remain and `/admin/teams` still works; it just has no
effect on behaviour, and the page says so.

"Activity" means the work-log feed — who logged which hours. A developer sees
only their own entries; the section is titled *Your activity* rather than
silently showing a partial list. Task status and blockers stay visible to
everyone on the project, so a delivery lead can still run reviews without
seeing the whole timesheet.

Muzammil (Sales Manager / BD) holds `head`, so he sees the whole pipeline; the
reps (Saqlain, Shahab) hold `sales` and see only their own deals. There is no
separate `sales_head` role — the distinction is `head` vs `sales`.

## Managing people

**People** in the nav (admins only; the route 404s for everyone else).

- Creating an account generates a 16-character password and shows it **once**.
  It is bcrypt-hashed immediately and is not recoverable — use *Reset password*
  if it is lost.
- The generated alphabet excludes `0/O/1/l/I`, because these get transcribed by
  hand into a chat message.
- Accounts are **deactivated, never deleted**: logged hours have to stay
  attributable to someone.
- Collaborators require an access expiry; it revokes itself on that date.
- An admin cannot deactivate their own account, and the last active admin
  cannot be switched off.
- `user.create`, `user.deactivate` and `user.reset_password` are written to
  `audit_log`.

## Security model

Access control is **app-layer RBAC**, defined once in
[src/lib/rbac.ts](src/lib/rbac.ts) as capabilities rather than role-name checks.
Project scoping lives in [src/lib/access.ts](src/lib/access.ts) and every
fetch-by-id goes through it — an unauthorised project id returns 404, not 403,
so ids cannot be probed.

Two tables carry a **row-level security backstop** on top of that:
`project_financials` and `user_rates`. They return zero rows unless the caller
opts in for that transaction via `withFinanceAccess()`. This is defence against
a future forgotten `WHERE` clause, not a substitute for the RBAC check.

For those policies to bind at all, the app must connect as `tavren_app`
(`NOSUPERUSER`, `NOBYPASSRLS`). **A superuser connection string silently
disables the entire backstop** — Postgres superusers bypass RLS unconditionally,
`FORCE` included. `scripts/bootstrap-roles.sql` creates the role correctly.

Nobody on the team should hold database credentials. RLS does not protect
against a table owner; not handing out connection strings does.

## Layout

```
src/db/schema.ts        17 tables, the whole data model
src/lib/rbac.ts         capabilities per role
src/lib/access.ts       project scoping / IDOR defence
src/lib/business-time.ts SLA clocks that skip nights and weekends
src/server/work-logs.ts the fan-out described above
src/server/blockers.ts  routing + client clock-stop
src/server/sweeps.ts    escalation, stale detection, health
src/server/reports.ts   hours by project and person, timesheet (read-only)
src/lib/csv.ts          CSV escaping, including formula defusal
src/server/audit.ts     the one way changes reach the audit trail
src/server/digest.ts    the daily status roll-up (queries)
src/lib/digest-format.ts how that roll-up reads (pure, tested)
src/server/webhooks.ts  delivery to Discord / Slack
src/server/capacity.ts  who is already booked, used at handoff
src/lib/logger.ts       structured JSON logging
src/app/log/page.tsx    the phone-first log screen
drizzle/                migrations, including the RLS backstop
```

## Reporting

**/reports** answers where the hours went, from the work logs themselves —
nothing on it is maintained by hand. Pick a date range (default: this calendar
month) and it gives hours by project against estimate, hours by person against
the capacity they actually had over that window's working days, and the
line-by-line timesheet. **Download CSV** exports the whole range.

The page narrows by capability rather than being withheld: without
`worklog.viewAll` you see your own entries and no per-person table, and the
budget column needs `finance.view`. The export uses the same helpers as the
page, so a CSV can never contain a row its requester could not see on screen.

CSV cells beginning `=`, `+`, `-` or `@` are prefixed with an apostrophe. Work
notes are free text, and a spreadsheet treats those as formulas on open.

## QA review

A task marked ready lands in **/review** for anyone holding `review.approve`,
scoped to projects they can see. Approving finishes the task; sending it back
returns it to `in_progress` with a reason — and the reason is **required**,
because a rejection with no explanation just guarantees another round trip.

Each decision is its own row in `reviews` rather than a status flag. A task
approved first time and one approved on the fourth attempt look identical from
`tasks.status`, and the difference between them is the entire point of tracking
QA. The queue shows the round number, and the reviewer's **first-pass rate**
falls out of the same data.

## Blocker routing

Blockers are **routed by rule, not broadcast**. The matrix lives in
[src/lib/blocker-routing.ts](src/lib/blocker-routing.ts) as a pure function over
a resolved context — no database, no auth, no clock — because it is the part
most likely to be argued about, and it should be testable without a server. Run
`npx tsx scripts/routing-matrix.mjs` to print the whole table.

Every category lands on exactly one of three owners:

| Blocker | Owner | Copied |
| --- | --- | --- |
| Missing access / asset / client approval / waiting on client | Sales owner | PM |
| Sales promised out of scope | Sales owner | PM |
| Requirement unclear, conflict, decision | PM | Delivery lead |
| Technical, QA, production incident, anything else | Delivery lead | PM |
| Waiting on another developer | That developer | PM |

A **project role beats the project default**: a project with its own tech lead
routes technical work to them rather than the standing delivery lead.

Two distinctions the model depends on:

- **Owner vs watcher.** Exactly one person owns a blocker and the SLA clock sits
  on them. Exactly one person is copied — normally the PM, or the delivery lead
  when the PM is already the owner, so somebody always has visibility without
  producing an inbox nobody reads.
- **Client-owned blockers stop the developer's clock.** `missing_access`,
  `missing_asset`, `client_approval` and `waiting_on_client` are the client's to
  answer; the stale-task sweep skips any task with an open blocker.

Severity sets the response window — low 16h, normal 8h, high 4h, critical 1h,
all in **business hours** — and a production incident is forced to critical no
matter what was ticked. The rule that fired is stored on the blocker, so "why
did this come to me" is answerable without re-deriving anything, and the
reporter is shown where it will go *before* they submit.

## Business hours

The team works **18:00–02:00 PKT** to overlap US client hours, which is
**13:00–21:00 UTC**. Every SLA clock, escalation step and staleness cutoff runs
on those hours — a blocker raised at the end of Friday's shift is not "24 hours
overdue" on Saturday evening, and escalating on raw elapsed time is the fastest
way to train people to ignore alerts.

The window is defined in [src/lib/business-time.ts](src/lib/business-time.ts) as
two UTC constants, and that simplicity is not incidental: 18:00–02:00 PKT does
**not** cross a UTC midnight, so a plain `getUTCDay()` weekend check lines up
exactly with Monday–Friday night shifts, and a whole shift's work logs land on
one `work_date`. If the shift ever moves such that it straddles 00:00 UTC, the
file has to become timezone-aware.

One shift is 8 hours, and "one working day without an update" is derived from
that rather than hard-coded, so changing the hours moves every dependent
threshold with it.

## Deadlines

Projects carry an internal date and a client-facing date. **Developers and
collaborators only ever see the internal one**, labelled plainly as
"Deadline" — someone who can see both knows the real deadline is the later one,
which is exactly the slack the buffer exists to hold. Calling it "internal" to
someone who cannot see the other would itself advertise that a later date
exists. These are server components, so the hidden date is never rendered and
never reaches the browser.

## Project membership

Who is on a project is managed from the project page (`project.manageMembers`).
This is load-bearing in two places, not cosmetic:

- **Tasks can only be assigned to project members.** Assigning work to someone
  who cannot open the project is not a useful state, so the picker lists
  members only. The create-project form asks for developers up front, and the
  team panel warns when a project has none.
- **Project roles are what blocker routing keys off.** Naming a technical
  overseer or QA reviewer here is what makes those categories route to a person
  rather than falling through to the default.

Someone with open tasks on a project cannot be removed from it — that would
orphan the work silently. Reassign first.

## Logging work

**/log** is the front door for anyone doing the work: one screen listing every
open task assigned to you, plus every active project for the calls and meetings
that belong to no task. Tap a row, put in hours and a line about what you did.
It is installable to a phone home screen and opens straight here, because the
hours get entered at 2am at the end of a shift and "find the laptop" is the step
that actually stops it happening.

`/` stays the partner view — the exception inbox.

## Time tracking

A developer opens a task, hits **Start**, and the hours are measured rather
than typed. On **Finish** they add a one-line note and the system writes the
work log, moves the task and notifies the reviewer — the same fan-out the
manual form uses, via `recordWorkInTx`, so the two paths cannot drift.

Elapsed time is **never stored as a running total**. `accumulated_seconds`
banks everything up to the last pause and `resumed_at` marks the current
segment, so elapsed is derived as `accumulated + (now - resumed_at)`. A closed
laptop, a killed tab or a server restart loses nothing, because nothing was
being ticked.

You can only time your own work, or **pick up** something nobody is assigned —
which claims the task, so the hours and the assignee agree about who did it.
Timing a colleague's task would file their hours under your name, and the
server refuses it whether or not the button is on screen.

One timer per person at a time. Starting a second names the running one rather
than silently stopping it — quietly discarding time somebody is still earning
is worse than refusing. A timer left running past 12h becomes an inbox item for
the person timing it, not their lead: it is a mistake, not misconduct.
Corrections require a reason, and the measured value is kept beside the
correction rather than overwritten.

## Business development

The BD screen answers one question: **is this rep busy, or actually producing
qualified opportunities?** Activity counts and outcome counts live on the same
row, so they can never be reported separately and flatter each other.

Pipeline: `sent → viewed → responded → meeting → qualified → won / lost`. Each
move stamps its own timestamp, so funnel timings come from real events rather
than one mutable "updated" column.

- **Response rate by category** is the number that changes behaviour. Volume
  says a rep is busy; this says which niches are worth bidding on at all.
- A rep can flag **needs a technical read**, which routes the job to a delivery
  lead and lands in their inbox. The lead sees only the proposals routed to
  them — they own none, so an owner-only filter would leave them unable to
  answer.
- Follow-ups default to two days out and become inbox items when they lapse.
- A won proposal carries `won_project_id`: the record *becomes* the sales →
  delivery handoff instead of being retyped.

### The handoff

Marking a proposal **won** puts an actionable item in every PM's inbox — a win
nobody converts is a deal with no delivery attached. Converting creates the
project with everything already known carried across: the rep who won it stays
`sales_owner`, the budget becomes the contract value, the notes become the
scope, and a new client is created if there is not one already. Members are
seeded so the named people can see it immediately.

The project is created as a **draft, never active**. A PM and delivery lead
still have to confirm assets, scope and team before work starts, and a project
that appeared already-running would skip that step.

The internal deadline is validated to fall on or before the client deadline.
An internal date after the client's is not a buffer — it is a missed deadline
waiting to happen.

## Two design decisions worth knowing

**Client delays never count against a developer.** A blocker categorised
`waiting_on_client` is marked client-owned: it routes to the sales owner rather
than the delivery lead, and the stale-task sweep skips any task with an open
blocker. Nagging someone for an update on work they have already reported they
cannot proceed with is how a reporting system loses credibility.

**Lifecycle and health are separate fields.** `draft/active/completed/archived`
is where a project is; `on_track/at_risk/blocked` is how it is doing. Health is
derived by the sweep from blockers and overdue tasks, never set by hand, so the
dashboard cannot drift from reality.
