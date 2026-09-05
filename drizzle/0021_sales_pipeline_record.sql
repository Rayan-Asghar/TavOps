-- The pipeline becomes a record of a deal, not a log of an outcome.
--
-- Hand-written, following 0020, and checked against the live database before
-- applying: proposals had no lost_reason, lost_note, last_chased_at or
-- chase_count, no proposal_lost_reason type existed, notifications had no
-- proposal_id, and neither proposals_chase_idx nor proposals_client_idx was
-- present. proposals.client_id already exists and is written by nothing.
--
-- READ THIS BEFORE ASSUMING IT REVERTS 0011.
--
-- 0011 dropped follow_up_due_at because it was a column a rep had to fill in:
-- the system asked for a plan and then nagged about the plan, which is pipeline
-- management this team does not do. Nothing here asks for a date. last_chased_at
-- records an event that already happened, and the moment a chase becomes due is
-- derived from the status and the clock -- so a rep who never touches the
-- feature still gets a correct queue. That is the test a derived signal has to
-- pass and the one the dropped column failed. It is the same property
-- flagEstimateOverruns has, and for the same reason.

-- Why we lose, in seven values rather than free text.
--
-- Free text does not aggregate, and the only reason to record a loss at all is
-- to be able to count them. Kept short deliberately: a taxonomy a rep has to
-- think about is one they will fill in wrongly, and every value here is a
-- different decision somebody else made about us.
CREATE TYPE "proposal_lost_reason" AS ENUM (
    'price',
    'no_response',
    'client_hired_other',
    'client_cancelled',
    'timeline',
    'scope_mismatch',
    'other'
);--> statement-breakpoint

ALTER TABLE "proposals" ADD COLUMN "lost_reason" "proposal_lost_reason";--> statement-breakpoint

-- The one sentence the enum cannot hold. Not a substitute for it: the action
-- requires the reason and leaves this optional.
ALTER TABLE "proposals" ADD COLUMN "lost_note" text;--> statement-breakpoint

-- An event, never an intention. NULL means "never chased", which is why the
-- index below coalesces to sent_at: the first chase is measured from the bid.
ALTER TABLE "proposals" ADD COLUMN "last_chased_at" timestamp with time zone;--> statement-breakpoint

-- Chasing four times and hearing nothing is a fact about the deal, and it is
-- what turns an endless nag into a prompt to mark the thing lost.
ALTER TABLE "proposals" ADD COLUMN "chase_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "proposals"
    ADD CONSTRAINT "proposals_chase_count_nonneg" CHECK ("chase_count" >= 0);--> statement-breakpoint

-- Rows lost before this column existed have no recorded reason, and the only
-- honest answer available for them is the one that says so. Runs BEFORE the
-- constraint below, which would otherwise refuse to apply over them.
UPDATE "proposals" SET "lost_reason" = 'other' WHERE "status" = 'lost';--> statement-breakpoint

-- A reason only means anything on a lost proposal, and a proposal that is lost
-- has one. The second half matters as much as the first: without it the column
-- keeps a stale answer after a deal is revived, and the loss counts include a
-- deal that was later won.
ALTER TABLE "proposals"
    ADD CONSTRAINT "proposals_lost_reason_only_when_lost" CHECK (
        ("status" = 'lost' AND "lost_reason" IS NOT NULL)
        OR ("status" <> 'lost' AND "lost_reason" IS NULL AND "lost_note" IS NULL)
    );--> statement-breakpoint

-- Matches the sweep's predicate exactly, including the coalesce, so the chase
-- query is an index scan rather than a filter over the whole pipeline.
CREATE INDEX "proposals_chase_idx" ON "proposals"
    ("status", (coalesce("last_chased_at", "sent_at")))
    WHERE "status" NOT IN ('won', 'lost');--> statement-breakpoint

-- client_id has been on this table since 0003 with nothing writing it. It gets
-- written now, so it gets an index.
CREATE INDEX "proposals_client_idx" ON "proposals" ("client_id");--> statement-breakpoint

-- A notification that cannot be clicked is a sentence, not a queue item.
--
-- project_id, task_id and blocker_id are already here and the inbox builds its
-- href from whichever is set. A follow-up notification belongs to a proposal
-- and to nothing else, so without this column the sweep produces rows a rep can
-- read and cannot act on -- which is how a signal turns into noise. The handoff
-- notification carries no structural link either; that is a gap to fix, not a
-- precedent to follow.
ALTER TABLE "notifications" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_proposal_id_proposals_id_fk"
    FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

-- Clear out the ghosts of the feature 0011 deleted.
--
-- The old follow-up chaser used this same kind and the same `followup:<id>`
-- dedupe key, and its rows were never resolved when the code was removed -- so
-- they have been sitting unread in three reps' inboxes since August. They also
-- carry no proposal_id, because the column did not exist.
--
-- That makes them worse than clutter. `notify()` upserts on
-- (user_id, dedupe_key) and, on conflict, only clears a snooze: it does not
-- rewrite the title, the body, or the new proposal_id. So every one of these
-- rows would permanently SHADOW the notification the new sweep tries to write,
-- and the sweep would report having flagged nine things while writing nothing.
-- The queue would look correct from the server and be dead on the screen.
--
-- Resolving them is not enough for the same reason -- the upsert would still
-- find them and still write nothing. They have to go. Nothing is lost: they
-- describe a state the new sweep re-derives from scratch within the hour.
DELETE FROM "notifications" WHERE "kind" = 'followup_due' AND "proposal_id" IS NULL;
