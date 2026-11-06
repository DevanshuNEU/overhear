import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    // The geist package imports next/font/local. Inlining it lets a test mock that import (src/app/fonts.test.ts).
    server: { deps: { inline: ["geist"] } },
  },
});
