-- What a bid costs to place, and whether we can place another one.
--
-- Hand-written, following 0023, and checked against the live database before
-- applying: no connect_ledger table, no connect_entry_kind type, and
-- notification_kind had no 'connects_low' label.
--
-- ## Why one signed ledger, and not purchases plus a spent column
--
-- The obvious shape is a `connect_purchases` table plus `connects_spent` on
-- `proposals`. It does not survive contact with Upwork, which also grants free
-- connects monthly, refunds them when a client hires nobody, expires unused
-- ones, and charges extra to boost a bid. Under that shape each of those
-- becomes another column or another table -- which is a ledger, assembled
-- badly, one emergency at a time.
--
-- A spend column on `proposals` is also a second copy of a fact, and this
-- codebase has ruled on that twice already in writing: work_log_costs is kept
-- off work_logs, and invoices were refused as "a second system of record".
-- A column and a ledger row can disagree, and on the first disagreement
-- neither is trusted. Per-bid consumption is a foreign key, not a column --
-- and as a row it also answers "what did boosting cost us this month", which
-- a column cannot answer at all.
--
-- ## What this deliberately does NOT answer
--
-- "What did winning this job cost to acquire." Pricing a spend needs a costing
-- basis -- FIFO, weighted average -- and a basis chosen for a report is a
-- number somebody will price a hiring decision off. So money lives on purchase
-- rows and NOWHERE else, and the CHECK below makes that structural rather than
-- a matter of discipline. This ledger answers two questions: how many connects
-- do we have, and what did we pay for connects this month.

CREATE TYPE "connect_entry_kind" AS ENUM (
    'purchase',   -- bought, with money attached
    'grant',      -- free monthly connects that come with the plan
    'bid',        -- spent placing a proposal
    'boost',      -- spent outbidding other freelancers on the same job
    'refund',     -- Upwork gave them back, usually because nobody was hired
    'expiry',     -- unused connects that aged out
    'reconcile'   -- the number on Upwork did not match ours; see below
);--> statement-breakpoint

CREATE TABLE "connect_ledger" (
    "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "kind"           "connect_entry_kind" NOT NULL,
    -- Always signed. The balance is sum(delta) and nothing else, so there is
    -- no second place for it to be wrong.
    "delta"          integer NOT NULL,
    "occurred_at"    timestamp with time zone DEFAULT now() NOT NULL,
    -- Purchases only. See the header: this is the whole anti-attribution rule.
    "amount_cents"   bigint,
    "currency"       varchar(3) DEFAULT 'USD' NOT NULL,
    "proposal_id"    uuid,
    "recorded_by_id" uuid NOT NULL,
    "note"           text,
    "created_at"     timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT "cl_delta_nonzero" CHECK ("delta" <> 0),

    -- The sign is not the writer's to choose. A purchase that decremented the
    -- balance would be indistinguishable from a bid in every report built on
    -- this table.
    CONSTRAINT "cl_sign_matches_kind" CHECK (
        ("kind" IN ('purchase', 'grant', 'refund') AND "delta" > 0)
        OR ("kind" IN ('bid', 'boost', 'expiry') AND "delta" < 0)
        -- A reconcile goes either way: that is what makes it a reconcile.
        OR ("kind" = 'reconcile')
    ),

    CONSTRAINT "cl_money_only_on_purchase" CHECK (
        ("kind" = 'purchase' AND "amount_cents" IS NOT NULL AND "amount_cents" > 0)
        OR ("kind" <> 'purchase' AND "amount_cents" IS NULL)
    ),

    CONSTRAINT "cl_bid_needs_proposal" CHECK (
        "kind" NOT IN ('bid', 'boost') OR "proposal_id" IS NOT NULL
    ),

    CONSTRAINT "cl_proposal_only_where_meaningful" CHECK (
        "proposal_id" IS NULL OR "kind" IN ('bid', 'boost', 'refund')
    ),

    -- A reconcile with no explanation is a number nobody can audit later.
    CONSTRAINT "cl_reconcile_needs_note" CHECK (
        "kind" <> 'reconcile' OR btrim(coalesce("note", '')) <> ''
    )
);--> statement-breakpoint

-- RESTRICT, not SET NULL, and the reason is a constraint interaction worth
-- stating: SET NULL would fire an UPDATE that then violates
-- cl_bid_needs_proposal, so deleting a proposal would fail with a confusing
-- CHECK error instead of an honest foreign-key one. RESTRICT says the true
-- thing directly -- those connects were really spent, and erasing the proposal
-- must not quietly rewrite the balance.
ALTER TABLE "connect_ledger" ADD CONSTRAINT "connect_ledger_proposal_id_proposals_id_fk"
    FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint

-- Same argument as proposals.owner_id: deleting a person must not change what
-- the company spent.
ALTER TABLE "connect_ledger" ADD CONSTRAINT "connect_ledger_recorded_by_id_users_id_fk"
    FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint

CREATE INDEX "cl_occurred_idx" ON "connect_ledger" ("occurred_at" DESC);--> statement-breakpoint

-- One bid and one boost per proposal. A double submit, or logging the same job
-- twice after a failed save, must not quietly spend the connects twice.
CREATE UNIQUE INDEX "cl_one_bid_per_proposal" ON "connect_ledger" ("proposal_id", "kind")
    WHERE "kind" IN ('bid', 'boost');--> statement-breakpoint

-- NOT RLS-gated, and that is a decision rather than an omission.
--
-- The 0001 finance backstop exists for contract value and for pay -- the two
-- things whose leak actually damages somebody. Connects cost pennies, everyone
-- who may bid needs the balance in order to know whether they can, and gating
-- it would drag withFinanceAccess into the hourly sweep and onto a screen with
-- no finance on it. tests/db/rls.test.ts asserts this table is NOT protected,
-- so the choice is recorded where a future reader will trip over it.
--
-- Not REVOKEd either, unlike audit_log. That is the trail of record for the
-- business; this is an operational count we keep about a system we do not
-- control, and making a fat-fingered 60 permanently uncorrectable buys
-- nothing. Every writer calls writeAudit in the same transaction instead, so
-- the trail lives in the table that IS revoked.

-- The alert. Added here, emitted from application code: a new enum value
-- cannot be USED in the transaction that adds it.
ALTER TYPE "notification_kind" ADD VALUE 'connects_low';
