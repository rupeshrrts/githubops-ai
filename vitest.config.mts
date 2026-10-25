import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
  resolve: {
    alias: {
      "@": root,
      // "server-only" throws outside Next's server bundle; tests import server modules directly.
      "server-only": `${root}tests/stubs/server-only.ts`,
    },
  },
});
