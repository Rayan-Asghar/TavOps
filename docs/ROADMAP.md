# ROADMAP

> The finalized plan for the current body of work. Written when a plan is
> approved; updated as phases land. `HANDOFF.md` says where we are *right now*;
> this says where we are *going* and why. Do not restate history here —
> that is `PROGRESS.md`.

**Approved:** 2026-09-04 · **Status:** Phase 1 complete; Phase 2 next

## Progress

- [x] Phase 0 — pre-existing defects: `usersRelations.rate` cardinality, `money()` currency
- [x] **Phase 1 — Commercial foundation** — done
  - [x] migration `0019_commercial_foundation.sql`, applied; snapshot + journal
  - [x] `src/db/schema.ts` + `tests/db/harness.ts` + `tests/db/rls.test.ts` (2→3 tables)
  - [x] `src/lib/rates.ts` — half-open window, refuses ambiguity (11 tests)
  - [x] `src/lib/margin.ts` — three identities, refuses mixed currency (19 tests)
  - [x] `src/lib/billable.ts` — inheritance chain (6 tests)
  - [x] `withFinanceAccessInTx`, `src/server/costing.ts`, wired into `recordWorkInTx`
  - [x] `tests/db/costing.test.ts` (9 tests, incl. the gate-closes assertion)
  - [x] `billable` on every write path: edit, timer, grid batch save, all forms
  - [x] `readTriStateCheckbox` + one shared `BillableField`
  - [x] `task_types` seeded (Harvest set); `recostWorkLogs`; `scripts/backfill-costs.ts`
        (proven on dev: 23 entries, 17 rated / 6 unrated, idempotent on rerun)
- [x] **Google sign-in** (unplanned, requested mid-flight) — one `maySignIn` rule for
      both providers, no auto-provisioning, DB lookup kept out of the edge-safe config
- [ ] **Phase 2B — the interface** ← in progress
  - [x] 2B.1 `PageHeader` — the five bands; `SectionIntro` reimplemented on it so the
        eleven existing pages migrate as they are rebuilt, not in one sweep
  - [x] 2B.2 `DateRangeStepper` + `stepRange` (months step by months); `/reports` migrated
  - [ ] 2B.3 filter chips + grouping as one system
  - [ ] 2B.4 view switchers (`/timesheet` Day|Week|Month, `/tasks` List|Board)
  - [ ] 2B.5 table conventions: group headers, inline bars, row actions, bulk checkbox
  - [x] 2B.6 **rates writer** — promoted to first: Phase 1's costing engine had no
        way to be fed, so `user_rates` was seed-only and most hours cost NULL. A
        change is a new row closing the old at the same date (half-open), audited
        without amounts (`head` has `audit.view` but not `rates.view`). Found and
        fixed two bugs doing it: the backfill never re-costed `unrated` rows, and
        the rate lookup compared instants where `resolveRate` compares UTC days.
        Still to do: the full Members *table* layout, and a time-off column once
        Phase 3 lands
  - [ ] 2B.9 global search over content, not just destinations
- [ ] **Phase 2A — the visible layer** ← in progress
  - [x] 2.4 project **money tab** — billing model + financials + retainer periods
        (all three had no writer at all), plus the margin strip with the
        "Not costed" honesty cell and the single-contributor suppression rule
        enforced in the query rather than the component
  - [x] 2.1 the project list carries money — Budget · Spent · Cost in BOTH density
        modes (the toggle changes density, never what is true), billing-model badge,
        uncosted hours shown beside the cost. Grouping by client deferred to 2B.3
        so it lands as a first-class control rather than one screen's special case
  - [ ] 2.2 clients directory
  - [x] 2.3 the two-tier reconciliation strip on `/reports` — hours identity in
        tier 1, money identity in tier 2 behind `finance.view`, "not costed" as the
        honesty cell, drill-downs shared by the screen and the CSV. **Closes
        DESIGN-STANDARD scorecard row C5.**
  - [ ] 2.5 saved views + cross-project tasks
- [ ] Phase 3 — Planning layer
- [ ] Phase 4 — Approvals + expenses
- [ ] Phase 5 — Hardening
- [ ] Phase 6 — Deployment (scheduler no longer blocks it — in-app heartbeat landed)

---


## Context

The question was what's missing and why the system feels basic. After reading the code
and studying Toggl, Toggl Track, Plane and Harvest side by side with their pricing tiers,
the answer is sharper than "it needs more features":

**Tavren has premium-tier engineering under a free-tier feature set.**

What these tools charge the most for, Tavren already has: append-only audit logs (Harvest
gates these at **Enterprise, $14/seat**), historical/retroactive rates (Toggl **Premium**,
Teamwork **Optimize**), granular permissions with a real RLS backstop (Everhour **Team**,
Harvest **Enterprise**), and revision history with reversals — which *none* of them offer.

What they give away at $0, Tavren does not have: a clients directory, expenses, invoicing,
a billable/non-billable split, budget-versus-spent on the project list, and milestones.

That asymmetry is the entire feeling of "basic." Nobody can see an RLS policy. Everyone
can see that the project list has no money on it. **The fix is to build the cheap,
visible, table-stakes layer that every competitor hands out free** — not to add more
sophistication underneath.

### Decisions locked

- **Billable inherits from task type**, overridable per project and per entry (the Harvest
  model: Design/Programming/PM billable, Business Development deliberately not).
- **Billing model per project is first-class** — Time & Materials / Fixed fee / Retainer —
  and leads the commercial work. Toggl exposes exactly these as project toggles; Tavren's
  single `contractValue` silently assumes one model and **cannot represent a retainer at
  all**.
- **In scope:** timesheet approvals + auto-lock, expenses, clients directory, saved views,
  cross-project tasks, and — weighted heavily — **a full interface rebuild modelled on
  these tools** (Phase 2B). The finding that drives it: all four converge on one page
  skeleton, and Tavren has eleven pages that each invent their own.
- **Features first, go live later.** Realistically 5–6 weeks, not 2.
- **Hosting deferred** (Phase 6). Flagged now so it does not surprise anyone: shared
  cPanel hosting from GoDaddy/Hostinger cannot run this — it needs a Node process, a
  Postgres server and real cron. A Hostinger VPS (~$5–8/mo) can.

### One proposed change to the agreed order

You earlier chose to lead with the planning layer, under the assumption this was a craft
project. Two things have changed, and I recommend the planning layer moves to **Phase 3**:

1. **The costing layer is a trunk; the planning layer is a leaf.** Approvals, expenses,
   the project list's money columns, the clients directory and every margin figure all
   depend on rates and `billable` existing. Nothing depends on milestones or forecasting.
2. **The "too basic" perception lives in the free-tier gaps**, not in forecasting. Nobody
   at a 10–20 person agency has ever said a tool felt basic because it lacked capacity
   simulation.

Phases 1–2 are also the ones a real team feels on day one. Reject this and I'll swap
Phase 3 to the front — the phases are independent enough that the order is genuinely yours.

### Phase map

| Phase | What | Depends on |
|---|---|---|
| **1** | Commercial foundation: billing models + retainers, task types, `billable`, rates → cost snapshot, margin math | — |
| **2A** | Visible layer: project list with money, clients directory, reconciliation strip, money tab, saved views, cross-project tasks | 1 |
| **2B** | **The interface**: page shell, date stepper, filter/group system, view switchers, table conventions, people table, global search | — (start in parallel) |
| **3** | Planning layer: milestones, time off, templates, capacity simulation, forecast, `/workload` | 2B for the shell |
| **4** | Workflow: timesheet approvals + auto-lock, expenses | 1, 2B |
| **5** | Hardening: seed safety, `requireCapability()`, session revocation, rate limiting, `/settings` | — |
| **6** | Deployment | 5 |

**2B has no data dependencies and should start immediately, in parallel with 1.** Every
later screen is then assembly rather than design, and the interface work stops being a
"pass" bolted on at the end — which is how it ends up feeling bolted on.

---

# Phase 1 — The commercial foundation

Everything downstream depends on this. Migration `0019`.

## 1.1 Billing models and retainers

```
billing_model  enum: 'time_and_materials' | 'fixed_fee' | 'retainer'
```

On `projects` (not `projectFinancials`, which is RLS-gated — the *model* is not sensitive,
only the amounts are; gating it would make the project list unable to show a badge).

**`retainer_periods`** — the thing Tavren currently cannot express at all:

```
retainer_periods
  id, project_id → projects (cascade)
  period_start date, period_end date        -- inclusive, one row per month
  included_hours numeric(8,2)
  amount_cents bigint, currency varchar(3)
  rollover_hours numeric(8,2) default 0     -- carried in from the prior period
  status: 'open' | 'closed'
  unique (project_id, period_start)
```

A retainer is *periodic*, so its budget, burn and margin are all per-period. Toggl's
framing — "keep an eye on progress, **one period at a time**" — is the whole design
constraint: a retainer project's "budget burn" is meaningless as a lifetime number.
Rollover is an explicit stored column rather than a derivation, because the rollover
policy is a commercial decision (some clients get it, some don't) and deriving it would
bake one policy into code.

The margin math then differs correctly per model:

| Model | Revenue | Budget burn is measured against |
|---|---|---|
| Time & Materials | Σ billable hours × rate | `budgetedHours` (a cap, may be null) |
| Fixed fee | `contractValue` | `budgetedHours`, lifetime |
| Retainer | the period's `amount_cents` | that period's `included_hours + rollover` |

## 1.2 Task types — the billable catalogue

```
task_types
  id, name varchar(80) unique, billable boolean not null default true,
  default_billable_rate numeric(10,2), order_index, is_active
```

Seeded from `scripts/seed.ts` with the Harvest set: Design, Programming, Project
Management, Marketing (billable); Business Development, Internal, Rework (not).

`tasks.task_type_id` (nullable FK, `on delete set null`) and
`work_logs.task_type_id` — the latter because `work_logs.taskId` is already nullable for
client calls and meetings, and those need a type too.

**Resolution order for `billable` at write time:** entry override → task's type → project
default → `true`. Resolved once, in `recordWorkInTx`, and **stored on the row** — not
resolved at read time, or changing a task type would retroactively restate invoiced
history.

This is strictly better than the per-entry checkbox: it is correct by default and needs no
one to remember anything. The checkbox still exists, pre-filled from the inherited value,
so an override is one click.

## 1.3 `billable` on work logs and revisions

`billable boolean not null default true` on **both** `work_logs` and `worklog_revisions`.
The default *is* the backfill and it is correct — every existing row was logged under an
implicit all-billable model, so this preserves every figure currently on screen bit for
bit. On the revisions table it is non-negotiable: `billable` is a billing fact, and "who
flipped this after the invoice went out" must have an answer.

Index: **one partial** — `(project_id, work_date) where billable = false and deleted_at is
null`. A plain btree on a ~90%-true column is worthless; the selective query is "show me
the non-billable time", which is the question the feature exists to answer.

## 1.4 Rates and costing — the one decision to not get wrong

**Snapshot at write time into a separate RLS-protected `work_log_costs` table**, keyed by
`work_log_id`, carrying `revision_id`, `basis`, the resolved rates, and `cost_cents` /
`revenue_cents`.

The obvious implementation — putting `internal_cost_per_hour` on `work_logs` — would place
pay data on the table that `grid-queries.ts`, `reports.ts::timesheet`, both CSV routes and
the 1009-line grid all select from, **retiring `0001_finance_rls_backstop.sql` overnight.**
A separate table keeps every existing query exactly as leak-proof as it is today.

Carrying `revision_id` makes staleness a SQL predicate (`= work_logs.current_revision_id`)
rather than a hope — and that becomes a visible figure ("Not costed: 14h"), which is what
stops the margin being read as complete when half the team has no rate row.

Read-time resolution is rejected because it would open the finance gate inside
`reports.ts::timesheet`, which is shared with `/api/reports/timesheet` and is the thing
guaranteeing a CSV can never contain a row the requester couldn't see on screen.

**`src/lib/rates.ts`** — pure resolver, **half-open `[effectiveFrom, effectiveTo)`**, UTC
calendar day. State loudly in the header that this is the *opposite* of `invoicedThrough`,
which `billing-lock.ts` documents as inclusive; a codebase with two date conventions must
name both at both sites. Zero matches → `unrated`, amounts null — **never today's rate,
never zero, never an average.** Two matches → `ambiguous`, amounts null — **never pick the
newest**, or cost depends on insertion order and the margin is irreproducible. Close the
hole with a partial unique index (`user_rates` has no uniqueness at all today): one
open-ended rate per person.

Writing the snapshot needs `tavren.finance_access`, which a plain `db.transaction` does not
have. Add `withFinanceAccessInTx(tx, fn)` beside `withFinanceAccess` in `src/db/index.ts`:
a savepoint, `SET LOCAL … = 'on'`, and an explicit `'off'` in a `finally`. **Do not** use a
`SECURITY DEFINER` function — `tests/db/rls.test.ts` asserts the app role cannot bypass
RLS, and a definer function hands back exactly that bypass.

**`src/lib/margin.ts`** — integer cents, `Math.round(Number(x) * 100)`, **rounded once per
work log, never on the aggregate**, so the reconciliation figures are literally the sum of
the rows the drill-down shows. Three identities asserted in tests: `billable +
nonBillable = logged`, `costed + uncosted = logged`, `revenue − cost = margin`. **Cost
applies to non-billable hours too** — a two-hour internal meeting costs money and earns
none, and ignoring that is the model Tavren has now. Every undefined ratio is `null`, never
`0` or `Infinity`. **Multi-currency: refuse** — return `{ok: false, reason:
"currency-mismatch"}` and say so in words, because with no exchange-rate table an implicit
1:1 conversion is a wrong number that looks right, and someone will price the next job off
it.

Two pre-existing one-liners to fix first: `usersRelations.rate: one()` should be `many()`
(`userRates` is a history table), and `format.ts::money()` hardcodes USD. Never `::float`
on a money aggregate — `::text` numeric or `::bigint` cents.

---

# Phase 2A — The visible layer

This is the phase that makes Tavren stop looking basic. Almost all of it is screens over
data Phase 1 just created.

## 2.1 The project list, rebuilt as Harvest's

Harvest's projects screen is its single highest-impact view, and it is free-tier:
**grouped by client**, with columns `Budget · Spent (progress bar) · Remaining (%) ·
Costs`, and a billing-model badge per row (`Time & Materials`). Tavren's list has a name,
a health chip and a density toggle.

Rebuild `src/app/(app)/projects/page.tsx` to that shape. Money columns gated on
`finance.view`; without it the row still shows hours against `budgetedHours`, which is
useful to everyone. Keep the existing density toggle and cookie. This is a day of work and
it changes the whole first impression of the app.

## 2.2 Clients directory

`/clients` and `/clients/[id]` over the `clients` table that already exists with no screen
— projects, contacts, hours, and behind `finance.view`, revenue and margin. Add a
`client_contacts` table (the current single inline contact cannot hold the two or three
stakeholders a real client has). Free tier in all five tools reviewed.

## 2.3 The `/reports` reconciliation strip, in two tiers

`billable`/`non-billable` is a *second, orthogonal* split of the same hours, and four cells
cannot carry two identities. So:

- **Tier 1, everyone:** Hours logged · Billable · Non-billable · Corrected
  (identity: billable + non-billable = logged). This is what DESIGN-STANDARD §2.3 asks for
  and closes scorecard row `C5`.
- **Tier 2, `finance.view`:** Revenue · Cost · Gross margin · **Not costed**
  (identity: revenue − cost = margin). The fourth cell is the honesty cell and links to
  exactly those entries.

Date basis stated below the strip: "Costed at the rate in effect on each entry's work
date." Every cell is a drill-down link, via new `?billable=`/`?costed=` params threaded
through the *same* `timesheet()` helper both the screen and the CSV route use.

**The single-contributor rule.** `rbac.ts` says plainly that "pay data is not granted by
inference." A project cost figure where one person logged all the hours *is that person's
rate*, recoverable by dividing by the hours shown beside it. So for a viewer without
`rates.view`, any cost or margin figure with fewer than two distinct contributors is
suppressed — computed in SQL via `count(distinct user_id)`, so no client component is
trusted to hide it. This will irritate heads on solo projects; the remedy is one deliberate
line granting `head` `rates.view`, not softening the rule.

## 2.4 Project money tab and the Toggl-style overview rail

`/projects/[id]?tab=money`, included in the `tabs` array only under `finance.view` (the
pattern the `sheet` tab already uses). Contract vs net contract vs platform fee; cost,
revenue, margin; budget burn; billable split; not-costed hours; per-person breakdown only
under `rates.view`.

On the overview, copy Toggl's right rail — a compact panel of what this project *is*:
billing model, estimate, billable, and (for retainers) the current period's included hours
and burn. It is the clearest "what kind of project is this" affordance in any of the four
tools.

## 2.5 Saved views + cross-project tasks

Tavren already keeps every filter in the URL, so **a saved view is just a named URL** —
Plane's Views concept for almost nothing:

```
saved_views: id, user_id, name, path, query, is_shared, order_index
```

Plus `/tasks` — a cross-project task list with the same filter-chip row. Tavren has no
cross-project view of tasks at all today; they are reachable only nested inside a project.

---

# Phase 2B — The interface

This is the half that decides whether Tavren *reads* like these tools. The finding that
matters: **all four converge on the same page skeleton**, and Tavren currently has eleven
pages that each invent their own. Build the skeleton once as components, then every screen
in this plan is assembly rather than design.

## 2B.1 The page shell — one contract, every page

Harvest, Toggl and Plane stack the identical five bands. Tavren should too:

```
┌─ TITLE BAR ──────────────────────────────────────────────────────────┐
│  Projects                    [+ New project] [Actions ▾] [Export] [🔍]│   band 1
├─ TAB ROW ────────────────────────────────────────────────────────────┤
│  Time · Profitability · Activity log · Saved reports                  │   band 2
├─ CONTROL ROW ────────────────────────────────────────────────────────┤
│  [← This week · 31 Aug – 06 Sep →]      [Group by ▾] [Filters] [⊞☰▤] │   band 3
├─ SUMMARY TILES ──────────────────────────────────────────────────────┤
│  Total hours 128.5 │ Capacity 175 │ ■ Billable 96 ■ Non-billable 32.5│   band 4
├─ CONTENT ────────────────────────────────────────────────────────────┤
│  grouped table / board / calendar                                     │   band 5
└──────────────────────────────────────────────────────────────────────┘
```

New `src/components/ui/page-header.tsx` taking `title`, `primaryAction`, `actions`,
`tabs`, and slots for the control and summary bands. Bands 2–4 are optional; band order
never varies. **The single highest-leverage change in this plan** — it makes eleven pages
consistent in one commit and every new screen free thereafter.

Rules from the recordings: primary action is always the **only** filled button, top-right.
Secondary actions are outline buttons beside it. Search sits inline in band 1 on list
pages (Harvest) or centred in the app header globally (Plane). Tabs are underline-active,
never pills.

## 2B.2 A real date-range stepper

Every one of the four has the same control: `← [📅 This week · 31 Aug – 06 Sep 2026] →`
with a granularity dropdown (`Day / Week / Month`, or Toggl's `5 Days ▾`). Tavren has ad
hoc `from`/`to` date inputs on `/reports` and a bare month picker on `/timesheet`.

`src/components/ui/date-range-stepper.tsx`, reading and writing the **existing** URL params
so it stays server-rendered and shareable. Arrows step by the current granularity. This one
component serves `/reports`, `/timesheet`, `/approvals`, `/workload` and the clients view.

## 2B.3 Filter chips, grouping, and saved views as one system

Harvest's Approvals row is the model: `Client ▾ · Project ▾ · Role ▾ · Department ▾ ·
Tags ▾ · Teammate ▾`, with disabled chips greyed rather than hidden — so you can see what
filtering is *possible*. Beside it, `Group by: Person ▾` and `Status: Pending Approval ▾`.

- `src/components/ui/filter-bar.tsx` — a declarative chip row driven by a config array,
  writing to the query string. Replaces the bespoke `ListFilters` usage on `/projects` and
  `/audit` and extends to every list.
- **Grouping is a first-class control**, not a variant page. Harvest groups projects by
  client and people by employee type; Toggl groups reports by member and task; Plane groups
  work items by state. Tavren has no grouping anywhere.
- **Saved views** (§2.5) then fall out for free: the chip state *is* the query string, so
  saving a view is saving a URL. Surface them exactly as Harvest does — a `Saved reports`
  tab in band 2, and as Plane does — a `Views` entry in the project sub-nav.

## 2B.4 View switcher

A segmented control at the right of band 3. Harvest: `Day | Week | Calendar`. Toggl: a row
of icon buttons (calendar / split / list / grid). Plane: list / board / calendar /
spreadsheet / gantt icons.

Tavren should ship **two** switchers and no more, because an unbacked view is worse than no
switcher: `/timesheet` gets `Day | Week | Month` and `/tasks` gets `List | Board`. The
board is grouped by `task_status`, reusing the same grouping engine as §2B.3. Persist the
choice in the URL, not in client state.

## 2B.5 Table conventions

Every table in all four tools follows the same rules; Tavren's `DataTable` should enforce
them:

- **Group header rows** that are themselves clickable and carry a count — `Employees (1) ▾`,
  `Example Client`. Collapsible, state in the URL.
- **An inline progress bar in the cell**, not a separate chart — Harvest's `Spent` column is
  a bar inside the row, and the Team screen puts a bar next to `Hours`. This is how
  budget-vs-spent gets read at a glance without a dashboard.
- **Right-aligned numerics with tabular figures** (Tavren already does this — keep it).
- **A per-row `Actions ▾` menu** as the last column, rather than icons appearing on hover.
  Discoverable, touch-friendly, and it is what all four do.
- **A leading checkbox column** for bulk operations. HANDOFF already lists bulk select as an
  open `C1` item; this is where it lands.
- **A utilisation bar with percentage gridlines** at 20/40/60/80 (Harvest Team screen) — the
  exact control `/workload` needs, and it satisfies DESIGN-STANDARD §3.7's "label directly
  on the mark".

## 2B.6 The people table — copy Toggl's Members screen wholesale

Toggl: `MEMBER · ROLE · TIME OFF (0 days taken / 0 days booked) · RATE · COST · WORKING
HOURS`, with an inline nudge: *"Set rates and costs per person — to calculate
profitability."*

That is precisely the screen Tavren's `/admin/users` should become, and it is where
`userRates` finally gets a writer — today the table is read by nothing **and written by
nothing but the seed script**. `RATE` and `COST` columns behind `rates.view`; `TIME OFF`
becomes the write path for the Phase 3 `time_off` table.

## 2B.7 The project overview right rail

Toggl's project page has a right rail of what the project *is* — `Recurring`, `Estimate`,
`Billable`, `Fixed fee`, each a toggle with one line of explanation, plus inline
`+ Add alert` / `+ Add milestone` / `+ Add attachment`. It answers "what kind of project is
this" faster than any table.

Tavren's version: billing model, estimate, billable default, retainer period status, and
`+ Add milestone` once Phase 3 lands. Fits the existing `/projects/[id]` overview tab
without a new route.

## 2B.8 Charts always ship with their numbers

Plane's burn-down puts a legend *list* beside the chart — `Today's ideal Pending 4 ·
Pending 3 · Started 1 · Scope 4`, then `Other: Done 1 · Unstarted 1 · Backlog 1`. The
numbers are readable with the chart ignored entirely.

This is DESIGN-STANDARD §3.7's table-fallback rule, already satisfied by a layout these
tools use by default. Apply it to the existing `MiniBars`/`BulletBar` in
`src/components/charts/index.tsx` and to everything new.

## 2B.9 Global search

All four search *content*; Tavren's ⌘K only navigates. Plane puts a search field dead
centre in the app header — the most-used control in the product.

Postgres full-text (`tsvector` + GIN) over projects, tasks, clients and work-log notes,
scoped through the existing `accessibleProjectIds`. Wire into the existing `cmdk` palette
as a second section beneath destinations, so the rule that the palette never offers a
destination the sidebar wouldn't is preserved — search results are *content*, not
destinations, and that distinction keeps the existing invariant intact.

## 2B.10 A rollout checklist

Harvest's `GETTING STARTED · 0 of 3 — Add a project · Track your first entry · Review your
week` is a dismissible band under the page header. For onboarding 10–20 agency members in
one week, that is worth more than any documentation. Three steps, per-user state, gone for
good once complete.

## 2B.11 What not to copy

The AI assistant widgets, the upgrade CTAs and trial banners, Plane's icon-rail double
sidebar (it exists to hold Wiki/AI, which Tavren doesn't have — Tavren's single grouped
sidebar already matches Harvest's verb-grouped IA more closely than it gets credit for),
and any view switcher whose views aren't genuinely built.

---

# Phase 3 — The planning layer

The original Phase 1, unchanged in design. **The governing claim: exactly two facts exist
that the database does not already hold — a milestone's date and a person's absence.**
Persist those two; derive allocation, utilisation, projected completion and burn on read.

**`milestones`** — `target_date` absolute, plus **`baseline_date` set once and never
edited**. Absolute because `projects.startDate` is nullable and mutable, so deriving dates
from it would mean correcting a start date silently moves every commitment the team made.
The baseline is what makes slip *measurable* — without it, moving a date makes the slip
disappear, which is exactly how planning tools lose people's trust. `tasks.milestone_id` is
**one nullable FK, not a join table**: a task under two milestones would have its remaining
hours double-counted in the forecast.

**`time_off`** — validated hard by Toggl, which sells it as "time off that powers capacity
planning… approved leave automatically reflected in team capacity." `hours_per_day` nullable
(null = fully out) so half-days need no second concept; overlapping rows legal, **lowest
`hours_per_day` wins**; `user_id` stays NOT NULL (a company holiday is ten rows, not a
nullable column that forces `OR user_id IS NULL` into every query).

**`project_templates`** — Toggl's "Start from template" and Harvest's "common tasks added
to all new projects". A DB table seeded from code with no CRUD UI yet: the people who know
what a Shopify build decomposes into are the heads, not whoever has repo access.

**`src/lib/capacity-model.ts`** — a scheduling simulation, not a due-date histogram.
Bucketing remaining hours into each task's due-date week produces "150% in week 3, 0% in
weeks 4–6" and hides that the overflow *has to go somewhere*. The simulation pushes it
forward and names the week it lands in. **One simulation per person across all their
projects** — per-project simulation gives every project 100% of that person and every
deadline looks fine. Overflow past a 12-week horizon is "beyond the horizon", never a date.
Utilisation bands Free/Booked/Full/Over, plus **Away** as a distinct neutral — never "0%
utilised", which reads as idle.

**`src/lib/forecast.ts`** — the honesty rule, and the sharpest idea in the plan:
unestimated work is **excluded from `remainingHours` and reported as a count**, never
defaulted to zero. That makes the projection a **floor**, so a predicted *slip* is sound
(you can only be more slipped) but a predicted *no-slip* is not — so with unestimated or
unassigned work the verdict may be `slipping` but never `on_track`; it degrades to
`unknown`. Forecast against `internalDueDate`, **never** `clientDueDate`, or the verdict
would differ by role. Burn adds `efficiency = burnRatio / progressRatio` — earned-value CPI,
the most predictive early signal on fixed-price work, rendered in words ("Spending 1.4×
faster than progress"), never as "CPI".

**`/workload`** — people down, weeks across, utilisation in the cell, as a real `<table>`
with `scope="row"`/`scope="col"`. Not a compromise: DESIGN-STANDARD §3.7 requires luminance
not hue, labels on the mark, and a table fallback for every chart — the banded cell
satisfies all three with components that already exist. Below it, **"Free next week"**
naming people and spare hours, because the literal answer shouldn't require reading a heat
map. In MANAGEMENT nav, gated on a new `capacity.viewTeam` — and because `layout.tsx`
derives palette destinations from the nav groups, it **cannot** be offered to a role the
sidebar withholds it from.

**Sweep integration** — `flagMilestoneSlips()` runs before `recomputeProjectHealth`, which
gains one new input: any `missed` milestone, or any slipping ≥5 business days, forces at
least `at_risk`. That two-line change is the moment `projects.health` stops being purely
backward-looking, and it is the cheapest high-value item in the phase. Alert levels
(`0 / 1 ≥2d / 2 ≥5d`) stored on the row, dedupe key `milestone_risk:${id}:L${level}` — a
raw slip number in the key would file a new inbox row every day it moved by one. **Recovery
resolves the alerts when slip drops back** — `notifications.ts` argues that an
honestly-emptiable queue is the whole product. **The sweep never moves `target_date`**;
auto-rescheduling is how a plan stops meaning anything.

New capabilities: `milestone.manage` (admin, head, plus `pm`/`tech_lead` per project),
`capacity.viewTeam`, `template.apply`. Two new notification kinds — `milestone_at_risk`,
`milestone_missed` — which `tone.ts`'s `Record<NotificationKind, …>` will fail `typecheck`
until they are placed. **That compile failure is the test.**

---

# Phase 4 — Workflow: approvals and expenses

**Timesheet approvals + auto-lock.** Harvest's Approvals page states the model exactly:
*"Time and expenses are still editable. You can set a recurring auto-lock from Settings…
Once set, time and expenses can't be edited after that deadline."* Tavren has the
**enforcement half** — `billing-lock.ts`, `grid-permissions.ts` and `work-log-writes.ts`
all honour `invoicedThrough` — and **no workflow half whatsoever**: nothing in the app
writes that column, so a fully-enforced lock can only be armed from `psql`.

- `timesheet_submissions` — `user_id`, `period_start`, `period_end`, `status`
  (`draft | submitted | approved | rejected`), `reviewed_by_id`, `reviewed_at`, `note`.
- `/approvals` — Harvest's layout: week picker, `Group by: Person`, filter chips, and a
  header splitting total time into billable/non-billable.
- `setInvoicedThrough` server action, gated on `finance.view` + `project.edit`, audited in
  the same transaction, **refusing to move the lock backwards without a reason string** —
  unlocking billed work is the dangerous direction and should read as an event.
- A recurring auto-lock setting that the existing hourly sweep applies.

**Expenses** — free-tier in Harvest and absent from Tavren entirely. `expenses`:
`project_id`, `user_id`, `spent_on`, `category`, `amount_cents`, `currency`, `billable`,
`markup_pct`, `receipt_url`, `note`, plus the same submitted/approved lifecycle. Margin
computed without expenses is simply wrong for an agency that pays contractors or ad spend.
Feeds the same `margin.ts` aggregates as cost.

**Invoicing stays out of scope.** `reports.ts` records the operative fact — Tavren invoices
from Wise. An `invoices` table is a second system of record for a document produced
elsewhere with nothing keeping the two in step; the first disagreement makes both
untrustworthy. Instead ship **"unbilled value"** — revenue for entries after
`invoicedThrough` — which is the number the partners actually want ("we are owed roughly
$X we haven't sent yet"), and name in a comment the condition under which a real invoice
model becomes right, so nobody relitigates it.

---

# Phase 5 — Hardening (before anyone real logs in)

1. **Seed safety.** Nine accounts share `tavren123`. Refuse to seed when
   `select count(*) from users` is non-zero — a better guard than `NODE_ENV`, which stays
   `development` when a misconfigured `.env.local` points somewhere real. Extract
   `generatePassword()` from `user-actions.ts` to `src/lib/password.ts` and give each
   seeded account a random password printed once.
2. **`requireCapability()`.** The `getActor()` → DB role re-fetch → `can()` → `notFound()`
   block is copy-pasted verbatim across 11 page files. New `src/lib/authz.ts` using React's
   `cache()` (per-render-pass; **not** `unstable_cache`, which is cross-request and wrong
   for per-user auth). Note the name collision: `src/lib/auth.ts` already exports a
   different `requireActor()`. Preserve exactly: role from the DB not the session, and 404
   not 403.
3. **Session revocation.** Deactivating someone leaves them logged in for up to 12h.
   `auth.config.ts` is deliberately edge-safe with zero DB imports, so the check **cannot**
   go in the `session` callback — it goes in `getActor()`, which is Node-only and already
   the choke point for server actions. Add `users.session_version`, put it in the JWT, and
   **fold `isActive` / `accessExpiresAt` / `session_version` into the query item 2 already
   makes** — so the round-trip costs nothing new. Extract
   `isSessionStillValid(token, row, now)` as a pure tested function.
4. **Login rate limiting.** One `rate_limit_buckets` table keyed `login:email:…` /
   `login:ip:…`, fixed window with escalating lockout, also covering password-change and
   reset. Be honest in the comment: with no reverse proxy, `x-forwarded-for` is spoofable,
   so **per-email is the trustworthy control** and per-IP is defence-in-depth.
5. **`/settings`** — no self-service anything exists today. Password change requiring the
   current password (and bumping `session_version`), name, and the scattered theme/density
   controls in one place.
6. **Dead enum values.** `feasibility_requested`, `feasibility_answered`, `followup_due` are
   emitted by nothing. Postgres cannot `DROP VALUE`; the real guard is a narrower
   `EmittableNotificationKind` on `notify()`. **Write no migration** — there is nothing to
   migrate.

---

# Phase 6 — Deployment (deferred, but scoped)

**Updated: the scheduler is no longer a hosting blocker.** The app schedules
itself from an open browser (`/api/heartbeat` → `src/server/scheduler.ts`), with
the server as sole authority on what is due, so sweeps, the sheet drain and the
digest all run without an external cron daemon. That removes the dependency
chain HANDOFF recorded — "hosting blocks the scheduler, which blocks every
automation" — and reduces the hosting requirement to *somewhere that runs a Node
process and Postgres*, with no cron facility needed.

What it does not cover: nothing runs overnight or across a weekend with no
browser open. For these three jobs that is acceptable — they recompute current
state rather than draining a backlog, so Monday produces one sweep rather than
sixty, and a missed digest is skipped rather than delivered late. Set
`IN_APP_SCHEDULER="off"` and wire real cron when that stops being true.

Hosting decision, then: a Dockerfile for the app, Postgres with
`scripts/bootstrap-roles.sql` actually run (**without it the RLS backstop is silently
disabled** — this is the precondition everything rests on), TLS, system cron hitting the
three `/api/cron/*` endpoints with `CRON_SECRET`, nightly `pg_dump` off-box,
`DIGEST_WEBHOOK_URLS` set, an `/api/health` endpoint, and the Sheets sync proven end to end
on one real project — still unproven today. Build needs
`NODE_OPTIONS=--max-old-space-size=4096`.

---

# Deliberately not building

- **A task dependency graph / critical path.** Nobody maintains one at ten people, and an
  unmaintained graph makes the forecast *worse* than the naive one, because it looks
  authoritative.
- **`invoices` / `invoiceLines`** — Phase 4 argument.
- **Any implicit currency conversion, including 1:1.**
- **`Billable` as a Google Sheet column** — `headerHash` would flip every existing
  connection to `error` on the next sync, and `shareable` sheets would show it to clients.
- **Auto-moving a milestone's `target_date`**, **`capacity_snapshots`**, **database
  sessions**, and **a developer-facing `/workload`** (an orphan route the palette can't
  reach).

# Verification

`pnpm verify` after every step; `pnpm verify:all` at each migration and phase end. Migration
numbering: `0019` Phase 1, `0020–0021` Phase 2, `0022–0023` Phase 3, `0024–0025` Phase 4,
`0026` Phase 5. **Every migration must be diffed against the live DB before applying** —
0016/0017 shipped without snapshots and the next `db:generate` re-emitted already-applied
work. Add every new table to `TABLES` in `tests/db/harness.ts`.

Key end-to-end checks, in a real browser:
1. A work log on a `Business Development` task lands `billable = false` **with nobody
   touching a checkbox**; overriding it on the entry sticks and produces a revision.
2. A rate added *later* does not change an already-costed entry; a `recostWorkLogs` run
   does, and writes an audit row.
3. `/reports` Tier 1 figures add up to the total, and each cell's drill-down returns
   exactly the rows it counted; the CSV for the same filters matches the screen row for row.
4. A single-contributor project shows `—` for cost to a `head` and a real number to an
   `admin`.
5. A retainer project's burn resets at the period boundary and carries rollover forward.
6. `tests/db/rls.test.ts` still passes, **including its updated 2→3 table assertions** —
   those failing on the first run is the point.
7. Phase 3: overflow capacity lands in a *later* week rather than showing >100% in one; a
   milestone past its date notifies **once** across two sweep runs, escalates once more at
   5 days, and resolves when pulled back.
8. Phase 2B: every page renders the same five bands in the same order, with exactly one
   filled button per screen; the date stepper, filter chips and grouping all round-trip
   through the URL, so a copied link reproduces the view exactly; and `/uxaudit` is re-run
   at the end of 2B for a real score against the 92-point rubric (baseline was 35, last
   estimate ~60 — and that estimate was scored by the session that did the work).

Commit with `git commit --only -F <msgfile> -- <explicit paths>` — never `git add -A`; a
PreToolUse hook denies bulk staging because several sessions share this index.
