CREATE TYPE "public"."blocker_severity" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
ALTER TYPE "public"."blocker_category" ADD VALUE 'missing_asset';--> statement-breakpoint
ALTER TYPE "public"."blocker_category" ADD VALUE 'client_approval';--> statement-breakpoint
ALTER TYPE "public"."blocker_category" ADD VALUE 'scope_conflict';--> statement-breakpoint
ALTER TYPE "public"."blocker_category" ADD VALUE 'commercial_scope';--> statement-breakpoint
ALTER TYPE "public"."blocker_category" ADD VALUE 'qa_issue';--> statement-breakpoint
ALTER TYPE "public"."blocker_category" ADD VALUE 'dependency_dev';--> statement-breakpoint
ALTER TYPE "public"."blocker_category" ADD VALUE 'production_incident';--> statement-breakpoint
ALTER TABLE "blockers" ADD COLUMN "severity" "blocker_severity" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "blockers" ADD COLUMN "blocked_on_user_id" uuid;--> statement-breakpoint
ALTER TABLE "blockers" ADD COLUMN "routing_rule" varchar(60);--> statement-breakpoint
ALTER TABLE "blockers" ADD COLUMN "watcher_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "blockers" ADD CONSTRAINT "blockers_blocked_on_user_id_users_id_fk" FOREIGN KEY ("blocked_on_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;