import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Unit tests only; nothing here may touch the network or a database. The
    // Sheets client gets a fake when the worker itself is covered.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
