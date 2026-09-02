-- A work-log sheet can now belong to a developer as well as to a project.
--
-- An entry belongs to both at once — it is somebody's work AND it is work on
-- something — so it is written to both sheets, and neither is derived from the
-- other. The sync job's idempotency key gains the connection id to match;
-- without that the two sheets' jobs collide on the same key and the second
-- sheet silently never receives its row.

CREATE TYPE "public"."sheet_scope" AS ENUM('project', 'developer');--> statement-breakpoint

-- Backfilled as 'project': every row that could already exist predates
-- developer sheets and had a NOT NULL project_id. The default is then dropped
-- so new rows must say which they are.
ALTER TABLE "sheet_connections" ADD COLUMN "scope" "sheet_scope" DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "sheet_connections" ALTER COLUMN "scope" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "sheet_connections" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The invariant the application would otherwise be trusted to keep: a
-- connection is owned by exactly one thing, and the owning column matches the
-- scope it claims. A row with both set, or neither, has no defined destination.
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_owner_matches_scope" CHECK (
  (scope = 'project'   AND project_id IS NOT NULL AND user_id IS NULL) OR
  (scope = 'developer' AND user_id    IS NOT NULL AND project_id IS NULL)
);--> statement-breakpoint

-- Partial on IS NOT NULL, not plain unique: the owning column is null for the
-- other scope, and NULLs being distinct would let a plain index permit any
-- number of rows. That is exactly what made sheet_connections_owner_unique
-- inert in the implementation this replaces.
DROP INDEX "sheet_connections_project_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_connections_project_unique" ON "sheet_connections" USING btree ("project_id") WHERE "sheet_connections"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_connections_user_unique" ON "sheet_connections" USING btree ("user_id") WHERE "sheet_connections"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sheet_connections_scope_idx" ON "sheet_connections" USING btree ("scope","status");
