import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Unit tests only; nothing here may touch the network or a database, so
    // `pnpm test` runs anywhere with nothing started.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // The fixture suite needs a real Postgres and has its own config and its
    // own env. Without this exclusion it is collected here too and fails for
    // want of a DATABASE_URL. Run it with `pnpm test:db`.
    exclude: ["**/node_modules/**", "tests/db/**"],
    environment: "node",
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
