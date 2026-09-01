-- One-way work-log mirror: Tavren -> a Google Sheet, one sheet per project.
--
-- Not a revival of the client-facing sync dropped in 0009. That one was
-- client-audience, carried per-project column mapping, and addressed rows by
-- number. This is internal-only, fixed-column, and addresses rows by the work
-- log's uuid written into the sheet itself.
--
-- Two constraints the old schema lacked, both from the audit that followed it:
-- one live connection per project, and one project per spreadsheet+tab. Both
-- columns are NOT NULL, so unlike sheet_connections_owner_unique these cannot
-- be silently permissive through NULLs being distinct.

CREATE TYPE "public"."sheet_connection_status" AS ENUM('active', 'paused', 'error', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sheet_visibility" AS ENUM('internal', 'shareable');--> statement-breakpoint
CREATE TYPE "public"."sync_job_type" AS ENUM('append', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "sheet_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"spreadsheet_id" varchar(120) NOT NULL,
	"spreadsheet_url" text NOT NULL,
	"tab_name" varchar(120) DEFAULT 'Sheet1' NOT NULL,
	"visibility" "sheet_visibility" DEFAULT 'internal' NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"header_hash" text,
	"status" "sheet_connection_status" DEFAULT 'active' NOT NULL,
	"error_message" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_row_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"work_log_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"work_log_id" uuid,
	"job_type" "sync_job_type" DEFAULT 'append' NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "sync_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_row_links" ADD CONSTRAINT "sheet_row_links_connection_id_sheet_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sheet_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_row_links" ADD CONSTRAINT "sheet_row_links_work_log_id_work_logs_id_fk" FOREIGN KEY ("work_log_id") REFERENCES "public"."work_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_sheet_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sheet_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_work_log_id_work_logs_id_fk" FOREIGN KEY ("work_log_id") REFERENCES "public"."work_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_connections_project_unique" ON "sheet_connections" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_connections_destination_unique" ON "sheet_connections" USING btree ("spreadsheet_id","tab_name") WHERE "sheet_connections"."status" <> 'archived';--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_row_links_unique" ON "sheet_row_links" USING btree ("connection_id","work_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_idempotency_unique" ON "sync_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sync_jobs_claim_idx" ON "sync_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "sync_jobs_connection_idx" ON "sync_jobs" USING btree ("connection_id");