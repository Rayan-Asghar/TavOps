import postgres from "postgres";
import { execSync } from "node:child_process";

/**
 * Prepares a throwaway database for the fixture tests.
 *
 * These tests exist because the highest-risk code in the app — project scoping
 * and the finance RLS backstop — cannot be covered by unit tests. Scoping is a
 * SQL predicate and RLS is a database feature; a mocked client would only
 * assert that the mock behaves like the mock.
 *
 * Runs against a SEPARATE database, never the dev one, because the assertions
 * need to control exactly which rows exist. `pnpm test` still runs pure unit
 * tests only and needs no database; these are `pnpm test:db`.
 */

const OWNER_URL =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  "postgresql://tavren:tavren_dev_pw@localhost:5433/tavren_ops_test";

const ADMIN_URL = OWNER_URL.replace(/\/[^/]+$/, "/postgres");
const DB_NAME = new URL(OWNER_URL).pathname.slice(1);

export default async function setup() {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    const [existing] = await admin`
      SELECT 1 FROM pg_database WHERE datname = ${DB_NAME}`;
    if (!existing) {
      await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`);
    }
  } finally {
    await admin.end();
  }

  // drizzle-kit reads MIGRATION_DATABASE_URL from the environment.
  execSync("pnpm drizzle-kit migrate", {
    stdio: "inherit",
    env: { ...process.env, MIGRATION_DATABASE_URL: OWNER_URL },
  });

  // The app role is cluster-wide, but its grants are per database. Mirrors
  // scripts/bootstrap-roles.sql; without this the app-role connection cannot
  // read anything and every test fails for the wrong reason.
  const owner = postgres(OWNER_URL, { max: 1 });
  try {
    await owner.unsafe(`
      GRANT CONNECT ON DATABASE "${DB_NAME}" TO tavren_app;
      GRANT USAGE ON SCHEMA public TO tavren_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tavren_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tavren_app;
    `);
  } finally {
    await owner.end();
  }
}
