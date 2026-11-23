import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import caseJson from "../../../../eval/engine/cases/mut-transfer-claim-caller-kept-asking-then-left.json";

const { createWebCall, getCall } = vi.hoisted(() => ({ createWebCall: vi.fn(), getCall: vi.fn() }));
vi.mock("@/pull/retell-source", async (original) => ({ ...(await original<object>()), createWebCall, getCall }));
const { ensureDemoData } = vi.hoisted(() => ({ ensureDemoData: vi.fn() }));
vi.mock("@/demo/ensure", () => ({ ensureDemoData }));
vi.mock("@/db/client", () => ({ db: {} }));
const envMock =vi.hoisted(() => ({ RETELL_API_KEY: "key_test_secret", RETELL_AGENT_ID: "agent_demo" as string | undefined }));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { POST } from "./route";
import { GET } from "./[callId]/route";
import { cookieFromHeader, DEMO_COOKIE, signDemoCookie, verifyDemoCookie } from "@/demo-call/cookie";
import { resetWebCallLimit } from "@/lib/web-call-limit";
import { OWNER_COOKIE, signOwnerCookie } from "@/demo-call/owner";
import { resetDemoCalls } from "@/demo-call/store";
import { DEMO_CALL_MESSAGE } from "@/demo-call/words";

const CALL_ID = "call_demo_1";
const WEB_CALL = { callId: CALL_ID, accessToken: "tok_1", transport: "gateway", iceServers: [{ urls: "stun:x" }] };
const record = (extra: Record<string, unknown> = {}) => ({ ...caseJson.record, call_id: CALL_ID, agent_id: "agent_demo", ...extra });

let n = 0;
/** Each test uses its own address, so the shared limiter's counts do not bleed between tests. */
const ip = () => `10.9.${Math.floor(++n / 200)}.${n % 200}`;
const start = (init: { body?: string; ip?: string; cookie?: string; origin?: string; host?: string; url?: string } = {}) =>
  new Request(init.url ?? "https://demo.example/api/demo-calls", {
    method: "POST",
    ...(init.body === undefined ? {} : { body: init.body }),
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
  getCall.mockReset();
  ensureDemoData.mockReset().mockResolvedValue(undefined);
  resetDemoCalls();
  resetWebCallLimit();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/demo-calls", () => {
  it("starts a web call on the demo agent and answers only what the browser needs to join", async () => {
    const res = await POST(start());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessToken: "tok_1", callId: CALL_ID, transport: "gateway", iceServers: [{ urls: "stun:x" }] });
    expect(createWebCall).toHaveBeenCalledWith("key_test_secret", "agent_demo", { dynamicVariables: { caller_timezone: "" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  describe("the caller's time zone", () => {
    const zoneSent = () => createWebCall.mock.calls[0][2].dynamicVariables.caller_timezone;
    it("passes a real IANA zone from the body as caller_timezone", async () => {
      expect((await POST(start({ body: JSON.stringify({ timeZone: "Asia/Kolkata" }) }))).status).toBe(200);
      expect(zoneSent()).toBe("Asia/Kolkata");
    });
    it.each([
      ["a zone that does not exist", { timeZone: "Mars/Olympus" }],
      ["letters outside the allowed set", { timeZone: "America/New York" }],
      ["too long", { timeZone: "A".repeat(65) }],
      ["not a string", { timeZone: 5 }],
      ["no timeZone key", { other: 1 }],
    ])("sends an empty zone for %s, and still starts the call", async (_name, body) => {
      expect((await POST(start({ body: JSON.stringify(body) }))).status).toBe(200);
      expect(zoneSent()).toBe("");
    });
    it("accepts an empty body or one that is not JSON", async () => {
      expect((await POST(start())).status).toBe(200);
      expect(zoneSent()).toBe("");
      createWebCall.mockClear();
      expect((await POST(start({ body: "not json" }))).status).toBe(200);
      expect(zoneSent()).toBe("");
    });
    it("ignores a large body unread", async () => {
      expect((await POST(start({ body: JSON.stringify({ timeZone: "Asia/Kolkata", pad: "x".repeat(2000) }) }))).status).toBe(200);
      expect(zoneSent()).toBe("");
    });
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

  it("counts a start only once Retell accepted it: failed creates use no budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const who = ip();
    createWebCall.mockRejectedValue(new Error("retell down"));
    for (let i = 0; i < 31; i++) expect((await POST(start({ ip: who }))).status).toBe(500);
    createWebCall.mockResolvedValue(WEB_CALL);
    for (let i = 0; i < 3; i++) expect((await POST(start({ ip: who }))).status).toBe(200);
    expect((await POST(start({ ip: who }))).status).toBe(429);
  });

  it("refunds a start that never reached Retell because no agent is configured", async () => {
    const who = ip();
    envMock.RETELL_AGENT_ID = undefined;
    for (let i = 0; i < 5; i++) expect((await POST(start({ ip: who }))).status).toBe(503);
    envMock.RETELL_AGENT_ID = "agent_demo";
    for (let i = 0; i < 3; i++) expect((await POST(start({ ip: who }))).status).toBe(200);
  });

  describe("the owner", () => {
    const ownerCookie = () => `${OWNER_COOKIE}=${signOwnerCookie("key_test_secret")}`;
    beforeEach(() => vi.stubEnv("DASHBOARD_PASSWORD", "secret"));

    it("skips the per-visitor public budget and has 10 starts per address", async () => {
      const who = ip();
      for (let i = 0; i < 10; i++) expect((await POST(start({ ip: who, cookie: ownerCookie() }))).status).toBe(200);
      const res = await POST(start({ ip: who, cookie: ownerCookie() }));
      expect(res.status).toBe(429);
    });

    it("is not stopped by a used-up public budget, and does not use it up", async () => {
      const who = ip();
      for (let i = 0; i < 3; i++) await POST(start({ ip: who }));
      expect((await POST(start({ ip: who }))).status).toBe(429);
      expect((await POST(start({ ip: who, cookie: ownerCookie() }))).status).toBe(200);
    });

    it("ignores a forged owner cookie", async () => {
      const who = ip();
      const forged = `${OWNER_COOKIE}=${Date.now()}.${"0".repeat(64)}`;
      for (let i = 0; i < 3; i++) await POST(start({ ip: who, cookie: forged }));
      expect((await POST(start({ ip: who, cookie: forged }))).status).toBe(429);
    });

    it("ignores the demo call cookie as an owner cookie", async () => {
      const who = ip();
      const wrong = `${OWNER_COOKIE}=${signDemoCookie(["call_a"], "key_test_secret")}`;
      for (let i = 0; i < 3; i++) await POST(start({ ip: who, cookie: wrong }));
      expect((await POST(start({ ip: who, cookie: wrong }))).status).toBe(429);
    });

    it("is no owner when no password is configured", async () => {
      vi.stubEnv("DASHBOARD_PASSWORD", "");
      const who = ip();
      for (let i = 0; i < 3; i++) await POST(start({ ip: who, cookie: ownerCookie() }));
      expect((await POST(start({ ip: who, cookie: ownerCookie() }))).status).toBe(429);
    });
  });

  it("tops up the demo clinic data before it starts a call, and starts the call even when that fails", async () => {
    expect((await POST(start())).status).toBe(200);
    expect(ensureDemoData).toHaveBeenCalledTimes(1);
    ensureDemoData.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await POST(start())).status).toBe(200);
    expect(createWebCall).toHaveBeenCalledTimes(2);
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
