-- Removes the client-facing Google Sheets sync.
--
-- TavrenOPS is internal-only: work is recorded in the app, Postgres is the
-- single source of truth, and anything leaving it is a report generated on
-- demand — not a live sync holding per-row state.
--
-- work_logs.client_update and worklog_revisions.client_update carried the
-- client-facing line and are DROPPED WITH THEIR DATA. A pg_dump was taken
-- before this migration was applied.
--
-- change_source.'sheet', audit_actor_type.'sync' and notification_kind.
-- 'sync_failed' survive: Postgres cannot drop a value from an enum in use, and
-- recreating those types costs more than three unused labels. Never write them.

DROP TABLE "sheet_connections" CASCADE;--> statement-breakpoint
DROP TABLE "sheet_row_links" CASCADE;--> statement-breakpoint
DROP TABLE "sheet_templates" CASCADE;--> statement-breakpoint
DROP TABLE "sync_jobs" CASCADE;--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "sync_job_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "sheet_row_ref";--> statement-breakpoint
ALTER TABLE "work_logs" DROP COLUMN "client_update";--> statement-breakpoint
ALTER TABLE "worklog_revisions" DROP COLUMN "client_update";--> statement-breakpoint
ALTER TABLE "worklog_revisions" DROP COLUMN "connection_id";--> statement-breakpoint
ALTER TABLE "worklog_revisions" DROP COLUMN "row_hash";--> statement-breakpoint
DROP TYPE "public"."sheet_audience";--> statement-breakpoint
DROP TYPE "public"."sheet_connection_status";--> statement-breakpoint
DROP TYPE "public"."sheet_link_entity";--> statement-breakpoint
DROP TYPE "public"."sync_job_type";--> statement-breakpoint
DROP TYPE "public"."sync_mode";--> statement-breakpoint
DROP TYPE "public"."sync_status";