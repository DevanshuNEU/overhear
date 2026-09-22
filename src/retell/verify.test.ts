import { describe, it, expect, vi } from "vitest";

vi.mock("retell-sdk", () => ({ Retell: { verify: (body: string, key: string, sig: string) => sig === "good" } }));
// env.ts's Proxy validates the *entire* schema on first property access, so
// without this mock this test would depend on a fully-populated real
// process.env (DATABASE_URL, ANTHROPIC_API_KEY, APP_URL, etc.) just to read
// RETELL_API_KEY. Mock it out to keep the test hermetic, matching how
// tools.test.ts mocks @/db/client to dodge the analogous top-level env read.
vi.mock("@/lib/env", () => ({ env: { RETELL_API_KEY: "test-key" } }));

import { verifyRetellSignature } from "./verify";

describe("verifyRetellSignature", () => {
  it("accepts a valid signature", async () => {
    expect(await verifyRetellSignature("{}", "good")).toBe(true);
  });
  it("rejects a missing or bad signature", async () => {
    expect(await verifyRetellSignature("{}", null)).toBe(false);
    expect(await verifyRetellSignature("{}", "bad")).toBe(false);
  });
});
