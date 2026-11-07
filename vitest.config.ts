import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Convex functions run in a V8 isolate, so the default test environment mimics that.
    // Files that need Node (the n8n cross-check) opt in with `// @vitest-environment node`.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
  },
});
