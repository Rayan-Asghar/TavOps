import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Unit tests only for now; nothing here may touch the network. The Sheets
    // client gets a fake in phase 3.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
