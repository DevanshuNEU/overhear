import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("needs only the database, the Retell key and the app URL; the rest is optional", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x", RETELL_API_KEY: "k", APP_URL: "http://localhost:3000",
    });
    expect(env.RETELL_AGENT_ID).toBeUndefined();
    expect(env.DASHBOARD_PASSWORD).toBeUndefined();
  });

  it("throws when a required key is missing", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://x" })).toThrow();
  });
});
