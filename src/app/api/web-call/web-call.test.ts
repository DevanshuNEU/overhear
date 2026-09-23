import { describe, it, expect, vi } from "vitest";

// This route must never hit the live Retell API in tests - mock the SDK's
// default export (the constructor the route imports) so `createWebCall`
// resolves a canned response instead of making a network call.
const { createWebCall } = vi.hoisted(() => ({
  createWebCall: vi.fn().mockResolvedValue({ access_token: "tok", call_id: "c1" }),
}));
vi.mock("retell-sdk", () => ({
  default: class MockRetell {
    call = { createWebCall };
  },
}));

// Same rationale as verify.test.ts: env.ts validates the whole schema on
// first access, so mock it to avoid depending on a fully-populated
// process.env just to read RETELL_API_KEY / RETELL_AGENT_ID.
vi.mock("@/lib/env", () => ({ env: { RETELL_API_KEY: "test-key", RETELL_AGENT_ID: "agent_1" } }));

import { POST } from "./route";

// Each test uses a distinct IP so the module-level rate limiter's per-instance
// state does not bleed one test's counter into another's.
const reqFrom = (ip: string) =>
  new Request("http://x", { method: "POST", headers: { "x-forwarded-for": ip } });

describe("POST /api/web-call", () => {
  it("mints a web-call access token via the Retell SDK", async () => {
    const res = await POST(reqFrom("10.0.0.1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ accessToken: "tok", callId: "c1" });
    expect(createWebCall).toHaveBeenCalledWith({ agent_id: "agent_1" });
  });

  it("rate limits a single IP after the per-visitor cap and returns Retry-After", async () => {
    const ip = "10.0.0.2";
    // The per-IP cap is 3 within the window; the first three succeed.
    for (let i = 0; i < 3; i++) {
      expect((await POST(reqFrom(ip))).status).toBe(200);
    }
    const res = await POST(reqFrom(ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const json = await res.json();
    expect(json.error).toBe("rate_limited");
  });
});
