-- Teams, and the collapse of pm / delivery_lead / sales_head into one `head`.
--
-- Hozefa, Hammad and Muzammil run the company jointly, so a global title that
-- pins each of them to one function is wrong as often as it is right. They now
-- share `head`; which of them owns a given item is decided by their role on the
-- project and by team membership.

CREATE TABLE "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "lead_id" uuid,
  "discipline" varchar(60),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "team_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "teams"
  ADD CONSTRAINT "teams_lead_id_users_id_fk"
  FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE set null;

ALTER TABLE "team_members"
  ADD CONSTRAINT "team_members_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade;

ALTER TABLE "team_members"
  ADD CONSTRAINT "team_members_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "teams_name_unique" ON "teams" ("name");
CREATE UNIQUE INDEX "team_members_unique" ON "team_members" ("team_id","user_id");
CREATE INDEX "team_members_user_idx" ON "team_members" ("user_id");

-- Postgres cannot drop a value from an enum in place, so the type is rebuilt
-- and the column cast across. Existing rows are mapped, not discarded.
ALTER TYPE "global_role" RENAME TO "global_role_old";

CREATE TYPE "global_role" AS ENUM ('admin','head','sales','developer','collaborator');

ALTER TABLE "users" ALTER COLUMN "global_role" DROP DEFAULT;

ALTER TABLE "users"
  ALTER COLUMN "global_role" TYPE "global_role"
  USING (
    CASE "global_role"::text
      WHEN 'pm'            THEN 'head'
      WHEN 'delivery_lead' THEN 'head'
      WHEN 'sales_head'    THEN 'head'
      ELSE "global_role"::text
    END
  )::"global_role";

ALTER TABLE "users" ALTER COLUMN "global_role" SET DEFAULT 'developer';

DROP TYPE "global_role_old";
