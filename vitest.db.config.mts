import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";
import path from "node:path";

/**
 * Fixture tests that need a real Postgres.
 *
 * Kept out of `vitest.config.mts` so `pnpm test` stays pure, fast and runnable
 * with nothing running. Run these with `pnpm test:db`.
 *
 * Both URLs are derived from `.env.local` with the database name swapped, so
 * there is no second set of credentials to keep in step — and no chance of
 * pointing the suite at the development database, which it truncates.
 */
loadEnv({ path: ".env.local", quiet: true });

const TEST_DB = "tavren_ops_test";

function intoTestDb(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  return url.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
}

const appUrl = intoTestDb(
  process.env.DATABASE_URL,
  `postgresql://tavren_app:app@localhost:5433/${TEST_DB}`,
);
const ownerUrl = intoTestDb(
  process.env.MIGRATION_DATABASE_URL,
  `postgresql://tavren:tavren_dev_pw@localhost:5433/${TEST_DB}`,
);

export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/db/global-setup.ts"],
    // The tests truncate shared tables between cases, so they cannot interleave.
    fileParallelism: false,
    sequence: { concurrent: false },
    env: {
      // `src/db` reads DATABASE_URL at import time, so it must be set before
      // any test module loads — which is what this does.
      DATABASE_URL: appUrl,
      TEST_MIGRATION_DATABASE_URL: ownerUrl,
    },
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
