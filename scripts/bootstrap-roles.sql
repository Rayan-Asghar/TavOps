-- Creates the least-privilege role the application connects as.
--
-- Migrations run as the owner (superuser); the app must NOT. A superuser
-- bypasses row-level security unconditionally, FORCE included, which would
-- make the finance backstop decorative. This role is NOSUPERUSER and
-- NOBYPASSRLS so the policies actually bind.
--
-- Run once per environment:
--   docker exec -i tavren-db psql -U tavren -d tavren_ops \
--     -v app_password="'<password>'" -f - < scripts/bootstrap-roles.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tavren_app') THEN
    CREATE ROLE tavren_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

\if :{?app_password}
  ALTER ROLE tavren_app PASSWORD :app_password;
\endif

GRANT CONNECT ON DATABASE tavren_ops TO tavren_app;
GRANT USAGE ON SCHEMA public TO tavren_app;

-- DML only. No DDL: the app can never drop a policy or disable RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tavren_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tavren_app;

-- Same grants for anything future migrations create.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tavren_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tavren_app;

-- The drizzle bookkeeping table is owner-only; the app never touches it.
REVOKE ALL ON SCHEMA drizzle FROM tavren_app;
