-- A work-log sheet belongs to one person on one project.
--
-- Two developers on a project keep two sheets; one developer on two projects
-- keeps two sheets. That is how the team's own trackers are already organised —
-- one file per person per engagement, a tab per month, the project's name in
-- the column heading.
--
-- This replaces the previous model, where a sheet was owned by EITHER a project
-- or a person and an entry was written to both. A sheet spanning one person's
-- projects is precisely what the team does not want.

-- Existing rows have only one side of the pair and no defined counterpart, so
-- there is nothing to migrate them to. There are none in any live environment
-- yet; anything present is a half-configured connection from development.
DELETE FROM "sync_jobs";--> statement-breakpoint
DELETE FROM "sheet_row_links";--> statement-breakpoint
DELETE FROM "sheet_connections";--> statement-breakpoint

ALTER TABLE "sheet_connections" DROP CONSTRAINT "sheet_connections_owner_matches_scope";--> statement-breakpoint
DROP INDEX "sheet_connections_project_unique";--> statement-breakpoint
DROP INDEX "sheet_connections_user_unique";--> statement-breakpoint
DROP INDEX "sheet_connections_scope_idx";--> statement-breakpoint

ALTER TABLE "sheet_connections" DROP COLUMN "scope";--> statement-breakpoint
DROP TYPE "public"."sheet_scope";--> statement-breakpoint

ALTER TABLE "sheet_connections" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sheet_connections" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "sheet_connections_pair_unique" ON "sheet_connections" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "sheet_connections_status_idx" ON "sheet_connections" USING btree ("status");
