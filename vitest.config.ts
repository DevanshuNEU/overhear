import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    // src/lib/env.ts eagerly parses process.env at module load (`export const env = parseEnv(process.env)`).
    // No real secrets exist in CI/test runs, so provide dummy values here purely to satisfy that
    // top-level parse when the module is imported — test assertions still exercise parseEnv() directly.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      RETELL_API_KEY: "test_key",
      ANTHROPIC_API_KEY: "test_key",
      APP_URL: "http://localhost:3000",
    },
  },
});
