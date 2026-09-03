-- Snooze, the fourth exit from the Needs Attention queue.
--
-- Hand-written rather than generated. `drizzle-kit generate` diffed against
-- snapshot 0015 -- the last one that exists, because 0016 and 0017 were written
-- by hand without snapshots -- and so re-emitted work those two already did:
-- dropping sheet_connections.scope and user_id, dropping the sheet_scope type,
-- and recreating the timer index. Applying that would have failed on the first
-- DROP COLUMN of a column that is already gone. This file carries only the
-- delta the database actually needs; the accompanying 0018 snapshot describes
-- the true target schema, so the next `generate` diffs from a correct base.
--
-- A snooze is not a resolution: resolved_at stays null, the row keeps its place
-- in Reports, and nothing is lost. A defer people cannot audit is a defer people
-- stop trusting.

ALTER TABLE "notifications" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "snoozed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dismiss_note" text;--> statement-breakpoint

-- The inbox filters on snoozed_until as well as resolved_at, so it belongs in
-- the covering index rather than forcing a heap lookup per row.
DROP INDEX IF EXISTS "notifications_user_idx";--> statement-breakpoint
CREATE INDEX "notifications_user_idx"
    ON "notifications" USING btree ("user_id","resolved_at","snoozed_until");
