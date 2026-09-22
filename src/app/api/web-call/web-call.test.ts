import { describe, it, expect, vi } from "vitest";

// This route must never hit the live Retell API in tests — mock the SDK's
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

describe("POST /api/web-call", () => {
  it("mints a web-call access token via the Retell SDK", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ accessToken: "tok", callId: "c1" });
    expect(createWebCall).toHaveBeenCalledWith({ agent_id: "agent_1" });
  });
});
