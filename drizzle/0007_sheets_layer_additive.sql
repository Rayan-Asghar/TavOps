CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system', 'sync');--> statement-breakpoint
CREATE TYPE "public"."change_source" AS ENUM('sheet', 'ui', 'api', 'system');--> statement-breakpoint
CREATE TYPE "public"."sheet_audience" AS ENUM('dev', 'client');--> statement-breakpoint
CREATE TYPE "public"."sheet_connection_status" AS ENUM('active', 'paused', 'error', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sheet_link_entity" AS ENUM('work_log', 'task', 'request');--> statement-breakpoint
CREATE TYPE "public"."sync_job_type" AS ENUM('append', 'update_row', 'write_back', 'protect', 'create_sheet', 'migrate_template');--> statement-breakpoint
ALTER TYPE "public"."sync_mode" ADD VALUE 'ingest' BEFORE 'append';--> statement-breakpoint
CREATE TABLE "sheet_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"audience" "sheet_audience" NOT NULL,
	"owner_user_id" uuid,
	"spreadsheet_id" varchar(120) NOT NULL,
	"drive_file_id" varchar(120),
	"tab_name" varchar(120) DEFAULT 'Sheet1' NOT NULL,
	"mode" "sync_mode" DEFAULT 'append' NOT NULL,
	"mapping" jsonb NOT NULL,
	"header_row" integer DEFAULT 1 NOT NULL,
	"client_editable" boolean DEFAULT false NOT NULL,
	"client_owned_columns" text[] DEFAULT '{}' NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"header_hash" text,
	"status" "sheet_connection_status" DEFAULT 'active' NOT NULL,
	"error_message" text,
	"last_poll_at" timestamp with time zone,
	"last_successful_poll_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "sheet_row_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "sheet_link_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"mapping_id" uuid,
	"connection_id" uuid,
	"row_key" text NOT NULL,
	"last_written_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "sheet_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audience" "sheet_audience" NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "worklog_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_log_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"task_id" uuid,
	"work_date" date NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"status_after" text,
	"internal_notes" text,
	"client_update" text,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"changed_by_user_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "change_source" DEFAULT 'ui' NOT NULL,
	"reason" text,
	"connection_id" uuid,
	"row_hash" text
);--> statement-breakpoint
ALTER TABLE "sync_jobs" DROP CONSTRAINT "sync_jobs_mapping_id_sheet_mappings_id_fk";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "global_role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "global_role" SET DEFAULT 'developer'::text;--> statement-breakpoint
DROP TYPE "public"."global_role";--> statement-breakpoint
CREATE TYPE "public"."global_role" AS ENUM('admin', 'head', 'sales', 'developer', 'collaborator');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "global_role" SET DEFAULT 'developer'::"public"."global_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "global_role" SET DATA TYPE "public"."global_role" USING "global_role"::"public"."global_role";--> statement-breakpoint
ALTER TABLE "sync_jobs" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sync_jobs" ALTER COLUMN "status" SET DEFAULT 'queued'::text;--> statement-breakpoint
-- The old enum had pending/success; the new one has queued/done. Remap while the
-- column is text, otherwise the cast back on the next statement fails.
UPDATE "sync_jobs" SET "status" = CASE "status"
  WHEN 'pending' THEN 'queued'
  WHEN 'success' THEN 'done'
  ELSE "status" END;--> statement-breakpoint
DROP TYPE "public"."sync_status";--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('queued', 'held', 'running', 'done', 'failed', 'error');--> statement-breakpoint
ALTER TABLE "sync_jobs" ALTER COLUMN "status" SET DEFAULT 'queued'::"public"."sync_status";--> statement-breakpoint
ALTER TABLE "sync_jobs" ALTER COLUMN "status" SET DATA TYPE "public"."sync_status" USING "status"::"public"."sync_status";--> statement-breakpoint
DROP INDEX "sync_jobs_status_idx";--> statement-breakpoint
DROP INDEX "sync_jobs_mapping_idx";--> statement-breakpoint
DROP INDEX "audit_log_actor_idx";--> statement-breakpoint
ALTER TABLE "sync_jobs" ALTER COLUMN "mapping_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ts" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_type" "audit_actor_type" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "after" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "source" "change_source" DEFAULT 'ui' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "sync_job_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "invoiced_through" date;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "job_type" "sync_job_type" DEFAULT 'append' NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "revision_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "run_after" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "held_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "released_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_logs" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "work_logs" ADD COLUMN "client_update" text;--> statement-breakpoint
ALTER TABLE "work_logs" ADD COLUMN "logged_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "work_logs" ADD COLUMN "current_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "work_logs" ADD COLUMN "source" "change_source" DEFAULT 'ui' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_logs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_row_links" ADD CONSTRAINT "sheet_row_links_connection_id_sheet_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sheet_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_revisions" ADD CONSTRAINT "worklog_revisions_work_log_id_work_logs_id_fk" FOREIGN KEY ("work_log_id") REFERENCES "public"."work_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_revisions" ADD CONSTRAINT "worklog_revisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_revisions" ADD CONSTRAINT "worklog_revisions_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sheet_connections_project_idx" ON "sheet_connections" USING btree ("project_id","audience");--> statement-breakpoint
CREATE INDEX "sheet_connections_status_idx" ON "sheet_connections" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_connections_owner_unique" ON "sheet_connections" USING btree ("project_id","audience","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_row_links_entity_unique" ON "sheet_row_links" USING btree ("entity_type","entity_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_row_links_rowkey_unique" ON "sheet_row_links" USING btree ("connection_id","row_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_templates_unique" ON "sheet_templates" USING btree ("audience","version");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_revisions_version_unique" ON "worklog_revisions" USING btree ("work_log_id","version");--> statement-breakpoint
CREATE INDEX "worklog_revisions_log_idx" ON "worklog_revisions" USING btree ("work_log_id","changed_at");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_sheet_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sheet_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_revision_id_worklog_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."worklog_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_project_idx" ON "audit_log" USING btree ("project_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_idempotency_unique" ON "sync_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sync_jobs_claim_idx" ON "sync_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "sync_jobs_connection_idx" ON "sync_jobs" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_held_idx" ON "sync_jobs" USING btree ("held_until");--> statement-breakpoint
CREATE INDEX "work_logs_live_idx" ON "work_logs" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","ts");--> statement-breakpoint
-- ===================================================================
-- Data migration. Everything below preserves rows the app already has.
-- ===================================================================

-- The one live sheet_mappings row becomes a client connection.
INSERT INTO "sheet_connections"
  (id, project_id, audience, spreadsheet_id, tab_name, mode, mapping,
   header_row, client_editable, template_version, status, last_sync_at, created_at)
SELECT m.id, m.project_id, 'client', m.spreadsheet_id, m.sheet_name,
       m.mode, m.column_map, m.header_row, false, 1,
       CASE WHEN m.is_enabled THEN 'active' ELSE 'paused' END::"sheet_connection_status",
       m.last_synced_at, m.created_at
FROM "sheet_mappings" m;--> statement-breakpoint
UPDATE "sync_jobs" SET connection_id = mapping_id WHERE connection_id IS NULL;--> statement-breakpoint
-- Existing jobs predate idempotency; their own id is unique and stable.
UPDATE "sync_jobs" SET idempotency_key = 'legacy:' || id::text WHERE idempotency_key IS NULL;--> statement-breakpoint
UPDATE "sync_jobs" SET run_after = next_attempt_at, finished_at = completed_at;--> statement-breakpoint
UPDATE "work_logs" SET internal_notes = notes WHERE internal_notes IS NULL;--> statement-breakpoint
UPDATE "work_logs" SET logged_at = created_at;--> statement-breakpoint
UPDATE "audit_log" SET ts = created_at, after = detail,
       actor_type = 'user', source = 'ui';--> statement-breakpoint
-- Every existing work log gets its v1 revision, so the revision chain is
-- complete from the start rather than beginning at the first future edit.
INSERT INTO "worklog_revisions"
  (work_log_id, version, task_id, work_date, hours, status_after,
   internal_notes, changed_by_user_id, changed_at, source, reason)
SELECT w.id, 1, w.task_id, w.work_date::date, w.hours, w.resulting_status::text,
       w.notes, w.user_id, w.created_at, 'ui', 'backfill: pre-revision entry'
FROM "work_logs" w;--> statement-breakpoint
UPDATE "work_logs" w SET current_revision_id = r.id
FROM "worklog_revisions" r
WHERE r.work_log_id = w.id AND r.version = 1;--> statement-breakpoint
-- Client template v1.
INSERT INTO "sheet_templates" (audience, version, definition) VALUES
('client', 1, '{
  "tabs": [
    {"name": "Timesheet", "mode": "append", "columns": [
      {"field": "work_date", "header": "Work Date"},
      {"field": "logged_at", "header": "Logged At"},
      {"field": "task_title", "header": "Task"},
      {"field": "developer_display_name", "header": "Developer"},
      {"field": "hours", "header": "Hours"},
      {"field": "entry_type", "header": "Entry Type"},
      {"field": "client_update", "header": "Client Update"},
      {"field": "revision_id", "header": "revision_id", "hidden": true}
    ]},
    {"name": "Tasks", "mode": "update", "columns": [
      {"field": "task_id", "header": "Task ID", "hidden": true},
      {"field": "task_title", "header": "Task"},
      {"field": "status", "header": "Status"},
      {"field": "estimate", "header": "Estimate"},
      {"field": "logged_hours", "header": "Logged Hours"},
      {"field": "last_update", "header": "Last Update"}
    ]}
  ]
}'::jsonb);--> statement-breakpoint
-- An audit trail the application can rewrite is not an audit trail.
REVOKE UPDATE, DELETE ON "audit_log" FROM tavren_app;
