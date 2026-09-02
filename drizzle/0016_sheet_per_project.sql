-- A work-log sheet belongs to a project, not to a person on a project.
--
-- What the team needs from a sheet is what was done and how long it took. Most
-- projects have one developer anyway, and on the rare one with two, that is the
-- same answer either way -- so a sheet per person doubled the setup to record a
-- distinction nobody reads off the sheet.
--
-- Who did the work is not lost: it is on the work log, shown in the project's
-- activity feed, and broken down per person in /reports, which answers "how much
-- did Ahmed do this month" better than a spreadsheet would. The template has no
-- Developer column and needs none.

-- Connections are keyed on the pair, so there is nothing to collapse them onto
-- without choosing whose sheet a project keeps. None exist outside development.
DELETE FROM "sync_jobs";--> statement-breakpoint
DELETE FROM "sheet_row_links";--> statement-breakpoint
DELETE FROM "sheet_connections";--> statement-breakpoint

DROP INDEX "sheet_connections_pair_unique";--> statement-breakpoint
ALTER TABLE "sheet_connections" DROP CONSTRAINT "sheet_connections_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "sheet_connections" DROP COLUMN "user_id";--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_connections_project_unique" ON "sheet_connections" USING btree ("project_id");
