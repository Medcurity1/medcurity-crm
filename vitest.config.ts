import { defineConfig } from "vitest/config";
import path from "path";

// Minimal standalone config for `npm test` (vitest). Kept separate from
// vite.config.ts (the build config) so test tooling can't affect the
// production build. Mirrors the "@" -> src alias from vite.config.ts so
// test files can import app modules the same way app code does.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
