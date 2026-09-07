-- The least-privilege application role, for a Supabase-hosted database.
--
-- Same job as bootstrap-roles.sql and the same reasoning: migrations run as the
-- owner, the app must NOT, because a role that bypasses row-level security
-- makes the finance backstop in 0001 decorative. Kept as a separate file rather
-- than branching the original, because three things differ and getting any of
-- them wrong fails quietly:
--
--   1. The database is called `postgres`, not `tavren_ops`.
--   2. Supabase's SQL editor is not psql, so the `\if :{?app_password}`
--      meta-command in the original cannot run. The password is inline here —
--      set it, run this once, then never commit the edited file.
--   3. Supabase's own `postgres` role is not a superuser but is far more
--      privileged than this app should be. Do not reuse it as DATABASE_URL.
--
-- RUN THIS AFTER MIGRATIONS. The final REVOKE names the `drizzle` schema, which
-- does not exist until drizzle-kit has run at least once.
--
-- Paste into the Supabase SQL editor, or:
--   psql "<session-pooler URL as postgres>" -f scripts/bootstrap-roles-supabase.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tavren_app') THEN
    CREATE ROLE tavren_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Replace before running. Use something long and random:
--   openssl rand -hex 20
ALTER ROLE tavren_app PASSWORD 'REPLACE_ME';

GRANT CONNECT ON DATABASE postgres TO tavren_app;
GRANT USAGE ON SCHEMA public TO tavren_app;

-- DML only. No DDL: the app can never drop a policy or disable RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tavren_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tavren_app;

-- Same grants for anything future migrations create. Note this is scoped to the
-- role that runs the migrations: if you migrate as `postgres`, this must be run
-- as `postgres` too, or future tables land without grants and the app starts
-- failing on exactly the newest feature.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tavren_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tavren_app;

-- The drizzle bookkeeping table is owner-only; the app never touches it.
REVOKE ALL ON SCHEMA drizzle FROM tavren_app;

-- Verify before trusting it. Both columns must be false, or the finance
-- backstop is off and every test still passes.
--   SELECT rolname, rolsuper, rolbypassrls
--     FROM pg_roles WHERE rolname = 'tavren_app';
