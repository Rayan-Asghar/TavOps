-- Cuts the BD pipeline back to what the team actually uses: proposals sent,
-- and jobs landed.
--
-- Feasibility routing (a rep flags a job, a head returns a technical read) and
-- follow-up chasing were both built for a BD team that does more pipeline
-- management than this one does. Neither was used, and both put chrome on the
-- one page the reps open every day.
--
-- IRREVERSIBLE. feasibility_note holds free text a delivery lead wrote about a
-- bid; nothing else records it. If that history matters, dump proposals before
-- migrating.
--
-- Not dropped here: notification_kind's 'feasibility_requested',
-- 'feasibility_answered' and 'followup_due'. Postgres cannot remove a value
-- from an enum type still in use, so they survive as dead labels the way
-- 'sync_failed' does. Notification rows already carrying them keep rendering —
-- the inbox reads title and body, not kind.
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_feasibility_assigned_to_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "proposals_followup_idx";--> statement-breakpoint
ALTER TABLE "proposals" DROP COLUMN "feasibility";--> statement-breakpoint
ALTER TABLE "proposals" DROP COLUMN "feasibility_assigned_to_id";--> statement-breakpoint
ALTER TABLE "proposals" DROP COLUMN "feasibility_note";--> statement-breakpoint
ALTER TABLE "proposals" DROP COLUMN "follow_up_due_at";--> statement-breakpoint
DROP TYPE "public"."feasibility_status";