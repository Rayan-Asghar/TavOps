# TavrenOPS — Architecture & Decision Record

The long-form "why" behind the code. `PROGRESS.md` at the project root is the
short, current status; this is the reference it points at when a decision needs
its reasoning. Written 2026-08-27.

Repo: <https://github.com/Rayan-Asghar/TavOps> · branch `main` · 9 commits, clean tree.

---

## 1. What this is

An internal operations app for **Tavren**, a ~10–15 person software/design agency
(Shopify, WordPress, automation, CRM). It replaces scattered Upwork threads,
Discord messages and Google Sheets with one system covering sales → delivery →
reporting.

The original brief is preserved verbatim at [docs/tavOps.md](docs/tavOps.md). It
was written before any code and describes ~30 modules; **it was deliberately not
built as written**. Section 4 below lists where the implementation departs from
it and why. Do not treat that document as the spec — treat it as the source of
intent.

### The one feature that justifies building rather than buying

Everything else here (tasks, projects, kanban) is available off the shelf. The
wedge is:

```
Developer submits one update
   ├─ work_logs row written
   ├─ task status + freshness clock updated
   ├─ reviewer notified
   ├─ row queued for the client's Google Sheet
   └─ that developer's "you owe an update" inbox item cleared
```

All in one transaction, in [src/server/record-work.ts](src/server/record-work.ts).
The Google call is deferred to a worker so a slow API never sits between a
developer and their submit button.

---

## 2. Stack and environment

| | |
| --- | --- |
| Framework | Next.js **16.3.3**, App Router, React 19, Turbopack |
| Language | TypeScript, strict |
| DB | Postgres 17 in Docker (`docker-compose.yml`), port **5433** |
| ORM | Drizzle 0.45 + drizzle-kit 0.31 |
| Auth | Auth.js v5 beta (`next-auth@5.0.0-beta.32`), JWT sessions, credentials provider |
| Styling | Tailwind v4 (CSS-first `@theme`, no `tailwind.config`) |
| Runtime | Node 24.17, pnpm 10.32 |

Notable Next 16 details that differ from older versions:

- Middleware is **`src/proxy.ts`**, not `middleware.ts` (the old name warns as
  deprecated).
- `PageProps<"/route">` / `LayoutProps<"/">` are generated route types. They only
  exist after a build; `src/app/projects/[id]/page.tsx` uses an explicit
  `{ params: Promise<{ id: string }> }` instead to avoid the chicken-and-egg.
- Tailwind v4 `@apply` resolves **utilities only**. It cannot apply another
  custom class. `.btn-primary` and `.btn-secondary` in
  [src/app/globals.css](src/app/globals.css) each repeat the base rather than
  composing a shared `.btn`. Trying to compose them fails the build with
  `Cannot apply unknown utility class 'btn'`.

---

## 3. Running it

```bash
cd /home/rayan/Desktop/TavrenOPS
docker compose up -d          # Postgres on :5433
pnpm install
pnpm dev                      # http://localhost:3000
```

`.env.local` already exists with working secrets and is **gitignored**. If it is
missing, see §9 (Known issues) before running `pnpm db:reset` — that script has a
trap.

### Seeded accounts — password `tavren123` for all

| Email | Role | Notes |
| --- | --- | --- |
| `contact@tavren.io` | `admin` | Rayan. Only role with `rates.view` and `user.manage`. |
| `hozefa@tavren.io` | `head` | Leads Shopify + WordPress teams |
| `hammad@tavren.io` | `head` | Leads Automation & AI team |
| `muzammil@tavren.io` | `head` | Leads Business Development team |
| `saqlain@tavren.io` | `sales` | Sales owner on NW-001 |
| `shahab@tavren.io` | `sales` | Owns 5 proposals |
| `ayan@tavren.io` | `developer` | In **two** teams — the overlap test case |
| `abdur@tavren.io` | `developer` | WordPress team |
| `ahmed@tavren.io` | `collaborator` | Has `accessExpiresAt` set — temp contractor |

**These are development accounts and must be deleted before real use.**

---

## 4. Key decisions, and why

These are the non-obvious calls. Changing any of them without reading the reason
will reintroduce a bug that was deliberately designed out.

### 4.1 Roles: 5, not 7 — `src/lib/rbac.ts`

`admin · head · sales · developer · collaborator`.

Hozefa, Hammad and Muzammil originally had `pm`, `delivery_lead` and
`sales_head`. **The user asked for these to be collapsed**: the three run the
company jointly and a global title pinning each to one function is wrong as often
as it is right. What any one of them owns is decided by their **project role**
(`project_members.role`) and by **team membership**, not by their global role.

Authorisation is **capability-based**, never role-name-based. Never write
`if (role === "head")`. Write `can(role, "finance.view")`. Capabilities:

```
project.create  project.edit  project.viewAll  project.manageMembers
task.create  task.assign  task.edit
worklog.create  worklog.viewAll
blocker.create  blocker.resolve  review.approve
sheet.configure  team.manage  deadline.viewClient
proposal.create  proposal.viewAll  feasibility.answer
finance.view  rates.view  user.manage  audit.view
```

Two corrections against the original spec's permission table, both of which
would have blocked real work on day one:

- The spec denied PM and delivery lead `worklog.create` — Hammad and Hozefa
  would never have been able to log the hours they bill.
- The spec let Sales create projects, contradicting its own handoff flow. Sales
  creates *proposals*; projects come from conversion or from a head.

### 4.2 RLS is a backstop, not the access control — `drizzle/0001_finance_rls_backstop.sql`

App-layer RBAC is the real control. Two tables additionally carry row-level
security: **`project_financials`** and **`user_rates`**. They return zero rows
unless the caller opts in for that transaction via `withFinanceAccess()` in
[src/db/index.ts](src/db/index.ts).

**This only works because the app connects as `tavren_app`, which is
`NOSUPERUSER NOBYPASSRLS`.** A superuser connection string silently disables the
entire backstop — Postgres superusers bypass RLS unconditionally, `FORCE`
included. This was discovered the hard way: an early test appeared to pass
because the table happened to be empty.

Hence two URLs in `.env.local`:

- `DATABASE_URL` → `tavren_app` (runtime, non-superuser)
- `MIGRATION_DATABASE_URL` → `tavren` (owner, drizzle-kit only)

`scripts/bootstrap-roles.sql` creates the role. Nobody on the team should hold
database credentials at all; RLS does not protect against a table owner, and not
handing out connection strings does.

### 4.3 404, never 403 — `src/lib/access.ts`

Every fetch-by-id goes through `canAccessProject()`. An unauthorised project id
returns **404**, not 403 — a 403 confirms the resource exists, which lets someone
enumerate project ids. Verified: Ayan gets 404 on a project he is not a member
of, 200 on his own.

### 4.4 Developers never see the client-facing deadline

Projects carry `internal_due_date` and `client_due_date`. Only roles with
`deadline.viewClient` (admin, head, sales) see the client one.

The reason is behavioural, from the user: a developer who sees "internal Sep 06 /
client Sep 13" knows the real deadline is the 13th, so the buffer stops existing.

Two implementation details that matter:

- For developers the field is labelled **"Deadline"**, not "Internal deadline".
  Calling it *internal* to someone who cannot see the other advertises that a
  second date exists.
- It is **not rendered at all** rather than hidden with CSS. These are server
  components, so an unrendered value never reaches the browser. Verified by
  grepping the served HTML: developer and collaborator get **0 occurrences** of
  the client date; head and sales get 2.

### 4.5 Blocker routing is rule-based — `src/lib/blocker-routing.ts`

`resolveBlockerRouting()` is a **pure function** over a resolved context: no
database, no auth, no clock. This is deliberate — the routing matrix is the part
most likely to be argued about and changed, so it must be readable in one screen
and testable without a server. Print the whole table with:

```bash
npx tsx scripts/routing-matrix.mjs
```

| Blocker category | Owner | Copied |
| --- | --- | --- |
| `missing_access` / `missing_asset` / `client_approval` / `waiting_on_client` | Client communication owner | PM |
| `unclear_requirement` / `scope_conflict` / `needs_decision` | PM | Delivery lead |
| `commercial_scope` | Deal owner | PM |
| `technical` | Technical overseer | PM |
| `qa_issue` | Project QA reviewer | Delivery lead |
| `dependency_dev` | That developer | Their lead |
| `production_incident` | Delivery lead | PM, immediately |
| anything else | **Reporter's team lead** | Project PM |

Three rules the model depends on:

1. **Owner vs watcher.** Exactly one person owns a blocker and carries the SLA
   clock. Watchers are notified with `is_actionable = false`. "Notify every
   manager" produces an inbox nobody reads.
2. **Project role beats project default.** A project with its own `tech_lead` or
   `qa` member routes there, not to the standing delivery lead.
3. **The reporter's team lead is always at least copied**, whatever the category.
   A lead should not learn second-hand that one of their people is stuck.

Severity sets the response window — `low` 16h, `normal` 8h, `high` 4h,
`critical` 1h — and `production_incident` is forced to critical regardless of what
was selected. `blockers.routing_rule` stores which rule fired, so "why did this
come to me" is answerable without re-deriving anything. The reporter is shown the
destination *before* submitting.

### 4.6 Teams are many-to-many — `teams`, `team_members`

A developer sits in several teams; a lead runs more than one person. So "who is
this person's lead" has **no single answer** and is resolved per blocker by
`preferredTeamLead()`, which prefers the lead who is also attached to that
project.

Seeded example: Ayan is in Shopify (lead Hozefa) and Automation & AI (lead
Hammad). A blocker he files on NW-001 — a Shopify project where Hozefa is
`tech_lead` — routes to **Hozefa**, with Hammad copied. Verified live:
`routing_rule = team_lead`, assigned to Hozefa.

### 4.7 SLA clocks run on business hours — `src/lib/business-time.ts`

A blocker filed 5pm Friday is not 24h overdue on Saturday evening. Escalating on
raw elapsed time trains people to ignore alerts.

**`addBusinessHours` handles negative input via a real backward walk
(`subtractBusinessHours`).** A naive `while (remaining > 0)` loop silently
no-ops on negative input and returns a cutoff *in the future* — which made every
in-progress task look stale. This was a live bug; do not "simplify" it back.

### 4.8 Client delays never count against a developer

- A blocker categorised as client-owned sets `owner_side = 'client'` and routes
  to the client owner, not the developer's lead.
- `flagStaleTasks()` in [src/server/sweeps.ts](src/server/sweeps.ts) **skips any
  task with an open blocker**. Nagging someone for an update on work they have
  already reported they cannot proceed with is how a reporting system loses
  credibility.

Verified: Ayan reported both seeded blockers and was chased for neither.

### 4.9 Timer time is derived, never ticked — `src/lib/timer-utils.ts`

`elapsed = accumulated_seconds + (now - resumed_at)`. `accumulated_seconds` banks
everything up to the last pause. Nothing increments a counter, so a closed
laptop, a killed tab or a server restart loses nothing. The React `Clock`
component holds only `now` in state and derives the display on render.

- **One timer per person.** Starting a second names the running one rather than
  silently stopping it — quietly discarding time somebody is still earning is
  worse than an error message.
- **You can only time your own tasks**, or *pick up* an unassigned one (which
  claims it, so the assignee and the hours agree). Enforced in
  `startTimer()` server-side, not just by hiding the button.
- Runaway timers past 12h nudge **the person timing**, not their lead. It is a
  mistake, not misconduct.
- Corrections require a reason and keep the measured value beside them.

### 4.10 Lifecycle and health are separate fields

`projects.lifecycle` = `draft | active | completed | archived` (where it is).
`projects.health` = `on_track | at_risk | blocked` (how it is doing). The spec
conflated these, which made "Active" and "At Risk" mutually exclusive when they
are orthogonal. Health is **derived** by `recomputeProjectHealth()` from open
blockers and overdue tasks, never set by hand.

### 4.11 QA decisions are rows, not a flag — `reviews` table

A task approved first time and one approved on the fourth attempt are identical
from `tasks.status`, and that difference is the entire point of tracking QA. Each
decision is its own row with a `round` number. The rejection **reason is
mandatory** — a rejection with no explanation guarantees another round trip.

### 4.12 `work_logs.task_id` is nullable

Client calls, scoping meetings and internal reviews are real billable work that
belongs to no task. The original data model had nowhere to put those hours.

### 4.13 Reads live outside `"use server"` modules

Every exported async function in a `"use server"` file becomes a **callable
server action**. `bdStats(actorId, seesAll)` in such a file would let a client
pass someone else's id. Read functions therefore live in plain modules:
`src/server/proposal-queries.ts`, `src/server/member-queries.ts`.

Also: a `"use server"` file may only export async functions. Exporting a Zod
schema from one fails at call time with:

```
Error: A "use server" file can only export async functions, found object.
```

Hence `src/server/schemas.ts`, `task-schemas.ts`, `timer-schemas.ts`,
`proposal-schemas.ts`, `handoff-schemas.ts`, `user-schemas.ts` are separate,
plain modules. Type-only exports (`export type`) are fine — they are erased.

### 4.14 Tasks are assignable only to project members

Assigning work to someone who cannot open the project is not a useful state. The
assignee picker lists `project_members` only. Consequently the create-project
form asks for developers up front, and the team panel warns when a project has
none. Someone with open tasks **cannot be removed** from a project — that would
orphan the work silently.

### 4.15 The project workspace is tabbed — `src/app/projects/[id]/page.tsx`

It grew to four stacked panels on the left and four forms on the right, roughly
2,200px tall. It is now **Overview · Tasks · Team · Activity**, around 1,000px.

- **Tab state lives in the URL** (`?tab=tasks`), not component state, so links
  are shareable, survive a refresh, and the content stays server-rendered —
  which is what keeps the permission checks on the server.
- **The right rail does not change between tabs.** What you are looking at
  should not change what you can do.
- Log work and Report blocker share one panel with a segmented control
  (`src/components/action-panel.tsx`). A developer does one or the other, never
  both at once; showing both tripled the rail height for no gain.
- Add-a-task is collapsed behind a `Disclosure`. Creating a task is occasional
  and should not occupy the page for everyone reading it.

`.attention-row` in `globals.css` is **two columns below `sm`**, three above. A
fixed three-column grid pushed the status badges off the left edge at 390px.

### 4.16 UI follows tavren.io

Extracted from the live site's CSS: accent `#FB0044` (hover `#d10050`), near-black
sidebar `#070707`, paper canvas `#f5f5f3`, **Inter** 300–700, `rounded-xl`
buttons. Tokens are semantic (`--color-brand`, `--color-fg`, `--color-danger`) in
[src/app/globals.css](src/app/globals.css); pages never hardcode a hex.

Crimson is reserved for brand actions and true urgency. Danger uses the deeper
`#c51d34` so a warning does not compete with the brand.

---

## 5. Every file, and what it does

### Database

| File | Purpose |
| --- | --- |
| `src/db/schema.ts` | All 18 tables, enums, relations. Single source of truth. |
| `src/db/index.ts` | Pooled connection (dev-reload safe) + **`withFinanceAccess()`** |
| `drizzle.config.ts` | Points drizzle-kit at `MIGRATION_DATABASE_URL` |
| `drizzle/0000_quiet_proemial_gods.sql` | Initial 13 tables |
| `drizzle/0001_finance_rls_backstop.sql` | RLS on financials + rates (hand-written) |
| `drizzle/0002_add_sales_head_role.sql` | Added `sales_head` (later removed by 0006) |
| `drizzle/0003_timer_and_proposals.sql` | `time_sessions`, `proposals` |
| `drizzle/0004_blocker_routing.sql` | Severity, 7 new categories, routing fields |
| `drizzle/0005_reviews_table.sql` | `reviews` |
| `drizzle/0006_teams_and_head_role.sql` | `teams`/`team_members`; **rebuilds the `global_role` enum** |

Migration 0006 is worth reading: Postgres cannot drop an enum value in place, so
it renames the type, creates a new one, casts the column with a `CASE` mapping
`pm`/`delivery_lead`/`sales_head` → `head`, then drops the old type. Existing rows
are mapped, not reset.

### Core libraries

| File | Purpose |
| --- | --- |
| `src/lib/rbac.ts` | Capability matrix, `can()`, `assertCan()`, `ORG_WIDE_ROLES` |
| `src/lib/access.ts` | `canAccessProject()`, `accessibleProjectIds()`, expiry checks |
| `src/lib/auth.ts` | Auth.js config, `getActor()`, `requireActor()` |
| `src/lib/auth.config.ts` | Edge-safe half — middleware imports this, not `auth.ts` |
| `src/lib/blocker-routing.ts` | **Pure** routing matrix. No DB. |
| `src/lib/business-time.ts` | `addBusinessHours` (both directions), `businessHoursBetween` |
| `src/lib/timer-utils.ts` | `elapsedSeconds`, `formatClock`, `secondsToHours` |
| `src/lib/cron-auth.ts` | Constant-time bearer check for `/api/cron/*` |
| `src/proxy.ts` | Auth gate on every route by default (deny-list, not allow-list) |

### Server actions (`"use server"`)

| File | Key exports |
| --- | --- |
| `src/server/record-work.ts` | `recordWorkInTx()` — **the fan-out**, shared by manual form and timer |
| `src/server/work-logs.ts` | `logWork()` |
| `src/server/timer.ts` | `startTimer` `pauseTimer` `resumeTimer` `finishTimer` `adjustTimer` `discardTimer` `activeSessionFor` |
| `src/server/blockers.ts` | `reportBlocker()` `resolveBlocker()` |
| `src/server/tasks.ts` | `createTask` `updateTask` `submitReview` |
| `src/server/project-actions.ts` | `createProject` `activateProject` |
| `src/server/project-members.ts` | `addProjectMember` `removeProjectMember` |
| `src/server/team-actions.ts` | `createTeam` `addTeamMember` `removeTeamMember` `setTeamLead` `deleteTeam` |
| `src/server/user-actions.ts` | `createUserAction` `setUserActiveAction` `resetPasswordAction` |
| `src/server/proposals.ts` | `createProposal` `advanceProposal` `answerFeasibility` |
| `src/server/handoff.ts` | `convertProposalToProject()` |
| `src/server/auth-actions.ts` | `loginAction` `logoutAction` |
| `src/server/form-actions.ts` | FormData wrappers returning `FormState` |
| `src/server/inbox-actions.ts` | `dismissNotification` |

### Plain server modules (not actions)

| File | Purpose |
| --- | --- |
| `src/server/notifications.ts` | `notify()` with dedupe, `inboxFor()`, `resolveByDedupeKey()` |
| `src/server/sweeps.ts` | `escalateBlockers` `flagStaleTasks` `recomputeProjectHealth` `flagRunawayTimers` `flagDueFollowUps` `runAllSweeps` |
| `src/server/sync-worker.ts` | `runSyncWorker()` — claims jobs with `FOR UPDATE SKIP LOCKED`, backoff |
| `src/server/sheets.ts` | Google Sheets client. `updateRowCells()` touches **only mapped columns**. |
| `src/server/proposal-queries.ts` | `bdStats` `listProposals` `conversionByCategory` `handoffOptions` `pendingHandoffCount` |
| `src/server/member-queries.ts` | `projectMembersFor` `assignableStaff` |
| `src/server/project-code.ts` | `nextProjectCode()` — "Northwind Apparel" → `NA-003` |
| `src/server/*-schemas.ts` | Zod schemas, kept out of action modules (see §4.13) |

### Pages

| Route | File | Gate |
| --- | --- | --- |
| `/login` | `src/app/login/page.tsx` | public |
| `/` | `src/app/page.tsx` | any signed-in — Needs Attention inbox |
| `/projects` | `src/app/projects/page.tsx` | scoped by `accessibleProjectIds` |
| `/projects/new` | `src/app/projects/new/page.tsx` | `project.create` |
| `/projects/[id]` | `src/app/projects/[id]/page.tsx` | `canAccessProject` → 404 |
| `/review` | `src/app/review/page.tsx` | `review.approve` → 404 |
| `/sales` | `src/app/sales/page.tsx` | `proposal.create` or `feasibility.answer` → 404 |
| `/admin/users` | `src/app/admin/users/page.tsx` | `user.manage` (admin only) → 404 |
| `/admin/teams` | `src/app/admin/teams/page.tsx` | `team.manage` → 404 |
| `/api/cron/sync` · `/api/cron/sweeps` | `src/app/api/cron/*/route.ts` | `CRON_SECRET` bearer |

### Components

`app-shell` (sidebar layout + `SectionIntro`) · `sidebar` · `icons` (inline SVG)
· `badges` (`Badge`, `HealthBadge`, `TaskStatusBadge`, `MetricGrid`, `MetricCard`)
· `task-timer` · `task-form` · `review-form` · `project-team` · `project-form`
· `blocker-form` · `log-work-form` · `proposal-form` · `proposal-actions`
· `handoff-form` · `team-manager` · `create-user-form` · `user-row-actions`
· `copy-field`

### Scripts

| Command | What |
| --- | --- |
| `pnpm db:seed` | 9 users, 4 teams, 2 clients, 2 projects, 6 tasks, 2 blockers, 3 work logs |
| `pnpm db:seed:proposals` | 13 proposals across 5 categories |
| `npx tsx scripts/routing-matrix.mjs` | Prints the whole blocker routing table |
| `npx tsx --env-file=.env.local scripts/run-sweeps.ts` | Runs sweeps directly |
| `pnpm sheets:doctor <id> [tab]` | Full Google Sheets round-trip test with actionable errors |
| `pnpm sheets:attach <code> <id> [tab] [mode]` | Attaches a sheet to a project, guessing columns from its headers |
| `bash scripts/bootstrap.sh` | Creates `tavren_app` role — **see §9.2 before running** |

---

## 6. Data model — 18 tables

```
users ──< team_members >── teams (lead_id → users)
users ──< project_members >── projects ──> clients
                               │
                               ├──< tasks ──< work_logs
                               │       ├──< time_sessions
                               │       ├──< blockers
                               │       └──< reviews
                               ├──< sheet_mappings ──< sync_jobs
                               └──1 project_financials     [RLS]
users ──1 user_rates                                       [RLS]
proposals ──> users (owner) ──> projects (won_project_id)
notifications · audit_log
```

16 enums: `global_role` `project_lifecycle` `project_health` `task_status`
`project_role` `blocker_category` (13 values) `blocker_severity` `blocker_status`
`owner_side` `review_decision` `timer_status` `proposal_status`
`feasibility_status` `sync_mode` `sync_status` `notification_kind`

---

## 7. Verify it still works

```bash
pnpm lint          # must be silent
npx tsc --noEmit   # must be silent
pnpm build         # must reach "Compiled successfully"
npx tsx scripts/routing-matrix.mjs   # prints the routing table
```

**There is no automated test suite.** Everything below was verified by hand with
Playwright driving a real browser plus SQL assertions. If you change any of these
paths, re-verify manually.

### Manual regression walkthrough

Sign in as `ayan@tavren.io` on **Northwind Shopify Rebuild**:

1. **Timer** — Start on one of his tasks. Clock ticks; every other Start greys
   out. Pause freezes it; Resume continues. Finish logs hours he never typed.
2. **Start button scope** — Hozefa must see **no** Start button on Ayan's tasks.
   Unassigned tasks show **Pick up**, which claims the task.
3. **Deadlines** — Ayan sees one date labelled "Deadline". View source: the
   client date must appear **0 times**.
4. **Activity** — header reads "Your activity — only entries you logged".
   Hammad's client-call entry must not appear.
5. **Blocker routing** — change category in the form and watch the hint change.
   File a QA issue: it must go to **Ahmed** (project QA), with Hozefa copied as
   non-actionable FYI.
6. **Review** — as Hozefa, `/review`. Request changes with no text → refused.
   With a reason → back to Ayan. Resubmit, approve → badge reads "Round 2".
7. **Permissions** — as Ayan, all of these must return **404**:
   `/review`, `/projects/new`, `/admin/users`, `/admin/teams`, and any project
   id he is not a member of.
8. **Sweeps** —
   ```bash
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/sweeps
   ```
   Without the header: `401`.

### Resetting the data

**Do not use `pnpm db:reset`** (see §9.2). Use:

```bash
TABLES=$(docker exec tavren-db psql -U tavren -d tavren_ops -t -A -c \
  "SELECT string_agg(format('%I', tablename), ', ') FROM pg_tables \
   WHERE schemaname='public' AND tablename <> '__drizzle_migrations';")
docker exec tavren-db psql -U tavren -d tavren_ops -c "TRUNCATE $TABLES RESTART IDENTITY CASCADE;"
pnpm db:seed && pnpm db:seed:proposals
```

---

## 8. What is done

| Area | State |
| --- | --- |
| Auth, 5 roles, capability RBAC | Working |
| Project scoping / IDOR defence (404) | Working, verified |
| RLS backstop on financials + rates | Working, verified as `tavren_app` |
| Projects: create, activate, membership | Working |
| Tasks: create, assign, estimate, due | Working |
| Work logs (task-level and project-level) | Working |
| Timer: start/pause/resume/finish/correct | Working, verified |
| Blockers: 13 categories, rule routing, severity SLA | Working, verified |
| Teams: many-to-many, overlap resolution | Working, verified |
| QA review queue, revision rounds, first-pass rate | Working, verified |
| Needs-Attention inbox with dedupe | Working |
| Escalation + stale + health + runaway-timer sweeps | Working, verified |
| BD pipeline, feasibility routing, conversion by category | Working, verified |
| Won proposal → draft project handoff | Working, verified |
| Admin user management, audit log | Working, verified |
| Sheets sync queue, retry, backoff, failure alerting | Working, verified |
| Per-project sheet setup in the app (Sync tab) | Working, verified |
| **Live Google Sheets write** | **Working — verified end to end against a real sheet** |

---

## 9. Known issues

### 9.1 Google Sheets is connected and proven

Verified 2026-08-27 end to end: a developer logged work in the app, the job
queued, `POST /api/cron/sync` drained it, and the row appeared in the real
spreadsheet with the correct date, task, developer, hours, notes and status.

Service account `tavren-sync@authentic-root-471504-q1.iam.gserviceaccount.com`,
credentials in `.env.local`. Currently attached to **NW-001** only
(`sheet_mappings` has one row).

Sheets are connected **per project, in the app**: the **Sync** tab on a project
page (`sheet.configure` — heads and admin). Paste the sheet URL, pick the tab,
adjust the guessed column mapping, connect. The tab also shows synced/queued/
failed counts, a Test connection button, retry for failed jobs, pause, and
disconnect.

There is **one shared service account** for the whole app, not one per head.
Access comes from sharing each spreadsheet with that address, so the address is
the first thing on the Sync tab rather than buried in documentation.

`pnpm sheets:doctor <spreadsheetId> [tab]` re-runs the full seven-check proof
against any sheet, including the one that matters: it writes into an unmapped
column as a client would, runs an update, and fails loudly if that column was
overwritten. Run it whenever a new client sheet is attached.

Three bugs were found by code review *before* the first real call, all of which
would have looked like Google's fault:

- Sheet names were unquoted in A1 ranges, so a tab called `Time Log` produced
  `Unable to parse range`. Fixed by `a1Range()`.
- `Math.max()` over an empty mapping gave `-Infinity` and an opaque
  `RangeError`.
- A column mapped as `"1"` rather than `"A"` produced a negative index and the
  value vanished silently.

Remaining caveat: only **append mode** has run against Google. `update` mode
(writing to a fixed row via `tasks.sheet_row_ref`) is exercised by the doctor's
check 6 but has never run through the worker on a real client template.

### 9.2 `pnpm db:reset` silently breaks the app

The script runs `bash scripts/bootstrap.sh`, which generates a **new random
password** for `tavren_app` and only *prints* it — it does not write it back to
`.env.local`. After running it, every request fails with a Postgres
authentication error until the URL is pasted in by hand.

Fix it or delete the script. Use the TRUNCATE recipe in §7 meanwhile.

### 9.3 No automated tests

Zero. Every claim in this document was verified by hand. The highest-value tests
to write first: the routing matrix (already a pure function — trivial to test),
the RLS backstop, and the 404-not-403 access checks.

### 9.4 Nothing runs on a schedule

`/api/cron/sync` and `/api/cron/sweeps` exist and are authenticated, but no
scheduler calls them. Escalation, stale detection, health recomputation and sheet
sync only happen when someone curls them.

### 9.5 Notifications are in-app only

There is no email, Slack or Discord delivery. The only way to learn anything is
to log in. Given the team lives in Discord, this is the biggest adoption risk.

### 9.6 Decisions the user has not made

- **`rates.view` is admin-only.** The three heads are partners and may well want
  it. One line in `src/lib/rbac.ts` — but pay data was not granted by inference.
- **Heads see all activity; nobody else does.** The user specified admin/PM/sales
  head. That now means all three heads. A `sales` rep sees only their own.

### 9.7 Untested edge

The assignee guard in `startTimer()` was verified through the UI but **not**
against a forged direct action request. It is a plain early return before any
insert, so it should hold, but it has not been proven that way.

### 9.8 Housekeeping

- Seed accounts share the password `tavren123`. Delete before real use.
- No Postgres backups configured.
- No error monitoring.
- `docs/tavOps.md` still reads as a 12-month commitment. It was never
  restructured into "built" vs "backlog"; the user was offered this and moved on.

---

## 10. Exact next steps, in order

### 10.1 ~~Prove the Sheets sync~~ — DONE 2026-08-27

Connected and verified (§9.1). What is left here:

- Attach the remaining projects: `pnpm sheets:attach <code> <spreadsheetId> [tab] [append|update]`
- Run `pnpm sheets:doctor` against each new sheet before trusting it.
- Exercise **update mode** through the worker on a real client template, which
  append mode's success does not prove.

### 10.2 Deploy and schedule

- Host somewhere with real cron. **Vercel Hobby is a trap**: its ToS forbids
  commercial use and Hobby cron runs *once per day*, which kills escalation.
  A €4/mo VPS with Docker, or Cloudflare Workers cron triggers, both work.
- Schedule `POST /api/cron/sync` every 2–5 min and `POST /api/cron/sweeps`
  hourly, with the `CRON_SECRET` bearer header.
- Configure Postgres backups before there is data worth losing.

### 10.3 Delete the seed accounts

Create real accounts through **People**, starting with the user's own admin, then
delete the nine `tavren123` accounts.

### 10.4 Then, in rough priority order

- **Discord bot** — post blockers into a channel and accept `/update`. Meeting
  developers where they already are will do more for adoption than any feature.
- **Automated tests** on routing, RLS, and the 404 access paths.
- Fix or remove `pnpm db:reset` (§9.2).
- Change requests / scope management — in the brief, not built.
- Client-facing status view — in the brief, not built.
