-- The commercial foundation: how a project earns, and what an hour costs.
--
-- Hand-written, following 0018. Verified against the live database before
-- writing: work_logs had no billable column, user_rates had no index beyond its
-- primary key, and projects carried invoiced_through but nothing describing how
-- the project is billed at all.
--
-- Three things arrive together because they are one idea:
--   1. HOW a project earns      -> projects.billing_model + retainer_periods
--   2. WHETHER an hour earns    -> task_types + work_logs.billable
--   3. WHAT an hour costs       -> work_log_costs
--
-- Money is stored as numeric, never float, matching project_financials.
-- contract_value and user_rates. Integer-cent arithmetic belongs in the
-- computation layer (src/lib/margin.ts), not in two competing storage
-- conventions -- a codebase with two ways to store money will eventually add
-- them together.

/* 1. How a project earns -------------------------------------------------- */

-- Lives on projects, not project_financials. The financials table is RLS-gated
-- because contract value is sensitive; the *shape* of the deal is not, and the
-- project list has to render a badge for it without opening the finance gate.
CREATE TYPE "billing_model" AS ENUM ('time_and_materials', 'fixed_fee', 'retainer');--> statement-breakpoint

ALTER TABLE "projects"
    ADD COLUMN "billing_model" "billing_model" NOT NULL DEFAULT 'time_and_materials';--> statement-breakpoint

CREATE TYPE "retainer_period_status" AS ENUM ('open', 'closed');--> statement-breakpoint

-- A retainer is periodic, so its budget, burn and margin are per period. A
-- lifetime "budget burn" on a retainer is a meaningless number.
--
-- rollover_hours is stored rather than derived because whether unused hours
-- carry forward is a commercial decision made per client. Deriving it would
-- bake one client's contract into the code.
CREATE TABLE "retainer_periods" (
    "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id"     uuid NOT NULL,
    "period_start"   date NOT NULL,
    "period_end"     date NOT NULL,
    "included_hours" numeric(8,2),
    "amount"         numeric(12,2),
    "currency"       varchar(3) DEFAULT 'USD' NOT NULL,
    "rollover_hours" numeric(8,2) DEFAULT '0' NOT NULL,
    "status"         "retainer_period_status" DEFAULT 'open' NOT NULL,
    "note"           text,
    "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "retainer_periods_end_after_start" CHECK ("period_end" >= "period_start")
);--> statement-breakpoint

ALTER TABLE "retainer_periods" ADD CONSTRAINT "retainer_periods_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint

-- One period per start date per project: two open periods covering the same
-- month would double-count every hour logged into it.
CREATE UNIQUE INDEX "retainer_periods_project_start_unique"
    ON "retainer_periods" USING btree ("project_id","period_start");--> statement-breakpoint

/* 2. Whether an hour earns ------------------------------------------------ */

-- The billable catalogue. Asking a person to classify every entry produces
-- entries that are never logged; inheriting from the kind of work produces the
-- right answer without anyone remembering anything. Business Development is
-- real work that no client pays for, and that is the case this exists for.
CREATE TABLE "task_types" (
    "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name"                  varchar(80) NOT NULL,
    "billable"              boolean DEFAULT true NOT NULL,
    "default_billable_rate" numeric(10,2),
    "order_index"           integer DEFAULT 0 NOT NULL,
    "is_active"             boolean DEFAULT true NOT NULL,
    "created_at"            timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "task_types_name_unique" ON "task_types" USING btree ("name");--> statement-breakpoint

-- ON DELETE SET NULL on both: retiring a task type must never delete work, and
-- must never delete the record of work.
ALTER TABLE "tasks" ADD COLUMN "task_type_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_type_id_task_types_id_fk"
    FOREIGN KEY ("task_type_id") REFERENCES "task_types"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "tasks_task_type_idx" ON "tasks" USING btree ("task_type_id");--> statement-breakpoint

-- work_logs carries its own type because work_logs.task_id is nullable: client
-- calls, scoping sessions and internal meetings have no task, and those are
-- exactly the entries whose billability is in question.
ALTER TABLE "work_logs" ADD COLUMN "task_type_id" uuid;--> statement-breakpoint
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_task_type_id_task_types_id_fk"
    FOREIGN KEY ("task_type_id") REFERENCES "task_types"("id") ON DELETE SET NULL;--> statement-breakpoint

-- NOT NULL DEFAULT true, and the default IS the backfill. Every existing row
-- was logged under an implicit all-billable model -- the invoiced/uninvoiced
-- split already reported on screen treats them that way -- so true preserves
-- every figure currently visible, exactly. Any other backfill would restate
-- history. Since PG 11 a non-volatile default is metadata-only, so no rewrite.
ALTER TABLE "work_logs" ADD COLUMN "billable" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- Non-negotiable on the revision chain: billable is a billing fact, and "who
-- flipped this to non-billable, and when" must have an answer for the same
-- reason the hours do.
ALTER TABLE "worklog_revisions" ADD COLUMN "billable" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- Partial, not a plain btree on billable. The column is overwhelmingly true, so
-- an index over all of it would never be chosen; the selective question -- "show
-- me the non-billable time" -- touches a small minority of rows, and that is the
-- question this whole feature exists to answer.
CREATE INDEX "work_logs_nonbillable_idx"
    ON "work_logs" USING btree ("project_id","work_date")
    WHERE "billable" = false AND "deleted_at" IS NULL;--> statement-breakpoint

/* 3. What an hour costs --------------------------------------------------- */

CREATE TYPE "cost_basis" AS ENUM ('rated', 'unrated', 'ambiguous');--> statement-breakpoint

-- A SEPARATE TABLE, and this is the load-bearing decision in this migration.
--
-- The obvious implementation is work_logs.internal_cost_per_hour. That would
-- put pay data on the table that grid-queries.ts, reports.ts::timesheet, both
-- CSV export routes and the timesheet grid all select from -- and would retire
-- 0001_finance_rls_backstop.sql overnight, silently, with no test failing.
-- Keeping cost in its own RLS-forced table leaves every existing query exactly
-- as leak-proof as it is today.
--
-- revision_id makes staleness a predicate rather than a hope: a cost is fresh
-- when it equals work_logs.current_revision_id. That is what lets the reports
-- strip show "not costed: 14h" instead of implying the margin is complete.
CREATE TABLE "work_log_costs" (
    "work_log_id"            uuid PRIMARY KEY NOT NULL,
    "revision_id"            uuid NOT NULL,
    "basis"                  "cost_basis" NOT NULL,
    "rate_id"                uuid,
    "internal_cost_per_hour" numeric(10,2),
    "billable_rate_per_hour" numeric(10,2),
    "currency"               varchar(3),
    "cost_amount"            numeric(12,2),
    "revenue_amount"         numeric(12,2),
    "costed_at"              timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "work_log_costs" ADD CONSTRAINT "work_log_costs_work_log_id_work_logs_id_fk"
    FOREIGN KEY ("work_log_id") REFERENCES "work_logs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_log_costs" ADD CONSTRAINT "work_log_costs_revision_id_worklog_revisions_id_fk"
    FOREIGN KEY ("revision_id") REFERENCES "worklog_revisions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_log_costs" ADD CONSTRAINT "work_log_costs_rate_id_user_rates_id_fk"
    FOREIGN KEY ("rate_id") REFERENCES "user_rates"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Same backstop as project_financials and user_rates, for the same reason and
-- by the same mechanism. The capability check in the application is the control;
-- this is what catches the careless future join.
ALTER TABLE "work_log_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_log_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "work_log_costs_requires_optin" ON "work_log_costs"
    FOR ALL
    USING (current_setting('tavren.finance_access', true) = 'on')
    WITH CHECK (current_setting('tavren.finance_access', true) = 'on');--> statement-breakpoint

/* 4. Make user_rates safe to resolve against ------------------------------ */

-- user_rates had no index and no uniqueness at all, so two overlapping rate rows
-- for one person were permitted. The resolver refuses ambiguity rather than
-- picking the newest -- picking would make an entry's cost depend on insertion
-- order, and an irreproducible margin is worse than a missing one -- but the
-- database should not permit the ambiguity in the first place.
CREATE INDEX "user_rates_user_from_idx"
    ON "user_rates" USING btree ("user_id","effective_from");--> statement-breakpoint

-- At most one open-ended rate per person. A full non-overlap guarantee needs an
-- exclusion constraint over a daterange with btree_gist; this is the floor that
-- costs no extension.
CREATE UNIQUE INDEX "user_rates_one_open_per_user"
    ON "user_rates" USING btree ("user_id") WHERE "effective_to" IS NULL;
