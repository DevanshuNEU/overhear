import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The pull layer and the key route hold the pasted Retell key, so they never print directly: every log line
  // goes through logSafe in src/pull/redact.ts, which redacts it.
  {
    files: ["src/pull/**", "src/app/api/connect/**"],
    rules: { "no-console": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Conductor's per-workspace scratch folder; git-ignored, never source.
    ".context/**",
  ]),
]);

export default eslintConfig;
