CREATE TYPE "public"."feasibility_status" AS ENUM('not_needed', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('sent', 'viewed', 'responded', 'meeting', 'qualified', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."timer_status" AS ENUM('running', 'paused', 'completed');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'feasibility_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'feasibility_answered';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'followup_due';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'timer_left_running';--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid,
	"job_title" varchar(300) NOT NULL,
	"job_url" text,
	"category" varchar(80),
	"source" varchar(40) DEFAULT 'upwork' NOT NULL,
	"budget_amount" numeric(12, 2),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "proposal_status" DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"meeting_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"feasibility" "feasibility_status" DEFAULT 'not_needed' NOT NULL,
	"feasibility_assigned_to_id" uuid,
	"feasibility_note" text,
	"follow_up_due_at" timestamp with time zone,
	"won_value" numeric(12, 2),
	"won_project_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" timer_status DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resumed_at" timestamp with time zone,
	"accumulated_seconds" integer DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone,
	"completion_note" text,
	"adjusted_seconds" integer,
	"adjustment_reason" text,
	"work_log_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_feasibility_assigned_to_id_users_id_fk" FOREIGN KEY ("feasibility_assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_won_project_id_projects_id_fk" FOREIGN KEY ("won_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_sessions" ADD CONSTRAINT "time_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_sessions" ADD CONSTRAINT "time_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_sessions" ADD CONSTRAINT "time_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_sessions" ADD CONSTRAINT "time_sessions_work_log_id_work_logs_id_fk" FOREIGN KEY ("work_log_id") REFERENCES "public"."work_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_owner_idx" ON "proposals" USING btree ("owner_id","sent_at");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "proposals_followup_idx" ON "proposals" USING btree ("follow_up_due_at");--> statement-breakpoint
CREATE INDEX "time_sessions_user_idx" ON "time_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "time_sessions_task_idx" ON "time_sessions" USING btree ("task_id");