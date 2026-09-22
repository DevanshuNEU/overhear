import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("defaults JUDGE_PROVIDER to jev and keeps JEV_API_KEY optional", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x", RETELL_API_KEY: "k",
      ANTHROPIC_API_KEY: "a", APP_URL: "http://localhost:3000",
    });
    expect(env.JUDGE_PROVIDER).toBe("jev");
    expect(env.JEV_API_KEY).toBeUndefined();
  });

  it("throws when a required key is missing", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://x" })).toThrow();
  });
});
