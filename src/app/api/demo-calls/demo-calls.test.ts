import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import caseJson from "../../../../eval/engine/cases/mut-transfer-claim-caller-kept-asking-then-left.json";

const { createWebCall, getCall } = vi.hoisted(() => ({ createWebCall: vi.fn(), getCall: vi.fn() }));
vi.mock("@/pull/retell-source", async (original) => ({ ...(await original<object>()), createWebCall, getCall }));
// /api/web-call builds the Retell SDK itself: stand in for it so this file never reaches the network. The rest of the module
// (APIError, which src/pull/retell-source.ts imports) stays as it is.
const { sdkCreateWebCall } = vi.hoisted(() => ({ sdkCreateWebCall: vi.fn() }));
vi.mock("retell-sdk", async (original) => ({
  ...(await original<object>()),
  default: class MockRetell {
    call = { createWebCall: sdkCreateWebCall };
  },
}));
const envMock =vi.hoisted(() => ({ RETELL_API_KEY: "key_test_secret", RETELL_AGENT_ID: "agent_demo" as string | undefined }));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { POST } from "./route";
import { GET } from "./[callId]/route";
import { POST as webCallPOST } from "../web-call/route";
import { cookieFromHeader, DEMO_COOKIE, signDemoCookie, verifyDemoCookie } from "@/demo-call/cookie";
import { resetDemoCalls } from "@/demo-call/store";
import { DEMO_CALL_MESSAGE } from "@/demo-call/words";

const CALL_ID = "call_demo_1";
const WEB_CALL = { callId: CALL_ID, accessToken: "tok_1", transport: "gateway", iceServers: [{ urls: "stun:x" }] };
const record = (extra: Record<string, unknown> = {}) => ({ ...caseJson.record, call_id: CALL_ID, agent_id: "agent_demo", ...extra });

let n = 0;
/** Each test uses its own address, so the shared limiter's counts do not bleed between tests. */
const ip = () => `10.9.${Math.floor(++n / 200)}.${n % 200}`;
const start = (init: { ip?: string; cookie?: string; origin?: string; host?: string; url?: string } = {}) =>
  new Request(init.url ?? "https://demo.example/api/demo-calls", {
    method: "POST",
    headers: {
      "x-forwarded-for": init.ip ?? ip(),
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
      ...(init.host ? { host: init.host } : {}),
    },
  });
const cookieFor = (...ids: string[]) => `${DEMO_COOKIE}=${signDemoCookie(ids, "key_test_secret")}`;
const ask = (id: string, cookie?: string) => GET(new Request(`https://demo.example/api/demo-calls/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ callId: id }) });

beforeEach(() => {
  vi.stubEnv("OVERHEAR_LOCAL", "");
  envMock.RETELL_AGENT_ID = "agent_demo";
  createWebCall.mockReset().mockResolvedValue(WEB_CALL);
  sdkCreateWebCall.mockReset().mockResolvedValue({ access_token: "tok", call_id: "call_web" });
  getCall.mockReset();
  resetDemoCalls();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/demo-calls", () => {
  it("starts a web call on the demo agent and answers only what the browser needs to join", async () => {
    const res = await POST(start());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessToken: "tok_1", callId: CALL_ID, transport: "gateway", iceServers: [{ urls: "stun:x" }] });
    expect(createWebCall).toHaveBeenCalledWith("key_test_secret", "agent_demo");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sets the cookie with the new call id: signed, httpOnly, Lax, Path=/, an hour, Secure on https", async () => {
    const res = await POST(start());
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/; Max-Age=3600; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    expect(verifyDemoCookie(cookieFromHeader(header), "key_test_secret")).toEqual([CALL_ID]);
  });

  it("leaves Secure off over plain http", async () => {
    const res = await POST(start({ url: "http://127.0.0.1:3355/api/demo-calls" }));
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("adds to the calls the cookie already holds and keeps the newest 3", async () => {
    createWebCall.mockResolvedValue({ ...WEB_CALL, callId: "call_e" });
    const res = await POST(start({ cookie: cookieFor("call_a", "call_b", "call_c") }));
    expect(verifyDemoCookie(cookieFromHeader(res.headers.get("set-cookie")), "key_test_secret")).toEqual(["call_b", "call_c", "call_e"]);
  });

  it("ignores a cookie it did not sign", async () => {
    const res = await POST(start({ cookie: `${DEMO_COOKIE}=1.call_a.${"0".repeat(64)}` }));
    expect(verifyDemoCookie(cookieFromHeader(res.headers.get("set-cookie")), "key_test_secret")).toEqual([CALL_ID]);
  });

  it("is limited per visitor, with a fixed sentence and Retry-After", async () => {
    const who = ip();
    for (let i = 0; i < 3; i++) expect((await POST(start({ ip: who }))).status).toBe(200);
    const res = await POST(start({ ip: who }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body).toMatchObject({ error: "rate_limited", message: DEMO_CALL_MESSAGE.rate_limited });
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(createWebCall).toHaveBeenCalledTimes(3);
  });

  it("shares its budget with /api/web-call: calls started there count here", async () => {
    const who = ip();
    const web = () => webCallPOST(new Request("https://demo.example/api/web-call", { method: "POST", headers: { "x-forwarded-for": who } }));
    for (let i = 0; i < 2; i++) expect((await web()).status).toBe(200);
    expect(sdkCreateWebCall).toHaveBeenCalledTimes(2);
    expect((await POST(start({ ip: who }))).status).toBe(200);
    expect((await POST(start({ ip: who }))).status).toBe(429);
    expect((await web()).status).toBe(429);
  });

  it("is 503 when no demo agent is configured, and never calls Retell", async () => {
    envMock.RETELL_AGENT_ID = undefined;
    const res = await POST(start());
    expect(res.status).toBe(503);
    expect(createWebCall).not.toHaveBeenCalled();
  });

  it("answers 404 on a local copy", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    expect((await POST(start())).status).toBe(404);
    expect(createWebCall).not.toHaveBeenCalled();
  });

  it("refuses a request that names another site as its origin, before the budget or Retell", async () => {
    const res = await POST(start({ origin: "https://evil.example", host: "demo.example" }));
    expect(res.status).toBe(403);
    expect(createWebCall).not.toHaveBeenCalled();
  });

  it("accepts a request from its own origin", async () => {
    expect((await POST(start({ origin: "https://demo.example", host: "demo.example" }))).status).toBe(200);
  });

  it("compares the scheme too: an http origin against an https destination is refused", async () => {
    expect((await POST(start({ origin: "http://demo.example", host: "demo.example" }))).status).toBe(403);
  });

  it("behind the TLS proxy (x-forwarded-proto https, url http) a matching https origin passes and an http one does not", async () => {
    const behind = (origin: string) => {
      const req = start({ origin, host: "demo.example", url: "http://demo.example/api/demo-calls" });
      req.headers.set("x-forwarded-proto", "https");
      return req;
    };
    expect((await POST(behind("https://demo.example"))).status).toBe(200);
    expect((await POST(behind("http://demo.example"))).status).toBe(403);
  });

  it("says a fixed sentence when Retell fails, never Retell's words or the key", async () => {
    createWebCall.mockRejectedValue(new Error("boom key_test_secret agent_demo"));
    const res = await POST(start());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain(DEMO_CALL_MESSAGE.failed);
    expect(text).not.toContain("boom");
    expect(text).not.toContain("key_test_secret");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET /api/demo-calls/{callId}", () => {
  it("is 404 with no cookie, and never asks Retell", async () => {
    expect((await ask(CALL_ID)).status).toBe(404);
    expect(getCall).not.toHaveBeenCalled();
  });

  it("is 404 for an id that is not in the cookie", async () => {
    expect((await ask(CALL_ID, cookieFor("call_other"))).status).toBe(404);
    expect(getCall).not.toHaveBeenCalled();
  });

  it("is 404 for a tampered cookie, and for something that is not an id", async () => {
    expect((await ask(CALL_ID, `${DEMO_COOKIE}=${signDemoCookie([CALL_ID], "another_key")}`)).status).toBe(404);
    expect((await ask("../etc", cookieFor("../etc"))).status).toBe(404);
    expect(getCall).not.toHaveBeenCalled();
  });

  it("is 404 for another agent's call, with nothing of it in the answer", async () => {
    getCall.mockResolvedValue(record({ agent_id: "agent_other" }));
    const res = await ask(CALL_ID, cookieFor(CALL_ID));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("agent_other");
  });

  it("is 404 on a local copy", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    expect((await ask(CALL_ID, cookieFor(CALL_ID))).status).toBe(404);
  });

  it("says processing while the call has not ended", async () => {
    getCall.mockResolvedValue(record({ call_status: "ongoing" }));
    const res = await ask(CALL_ID, cookieFor(CALL_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "processing" });
  });

  it("answers ready with the list row the engine made, and nothing else of the call", async () => {
    getCall.mockResolvedValue(record());
    const res = await ask(CALL_ID, cookieFor(CALL_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.row).toMatchObject({ callId: CALL_ID, state: "report", verdict: "failed" });
    expect(Object.keys(body).sort()).toEqual(["row", "status"]);
  });

  it("says did_not_connect for a call that never connected", async () => {
    getCall.mockResolvedValue(record({ call_status: "not_connected" }));
    expect(await (await ask(CALL_ID, cookieFor(CALL_ID))).json()).toEqual({ status: "did_not_connect" });
  });

  it("says a fixed sentence when Retell fails, never Retell's words", async () => {
    getCall.mockRejectedValue(Object.assign(new Error("Retell says key_test_secret is wrong"), { status: 401 }));
    const res = await ask(CALL_ID, cookieFor(CALL_ID));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain(DEMO_CALL_MESSAGE.unavailable);
    expect(text).not.toContain("key_test_secret");
  });
});
