// @vitest-environment node
// The test call line without HTTP: the agent list, starting a web call (one at a time), and the after-call fetch that waits
// for Retell. Retell is a fake fetch that routes by path and counts requests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRecordOf } from "@/pinned/testing";
import { failedSample } from "@/report/samples";
import { analyzeCall } from "./analyzer";
import { writeKey } from "./key-store";
import { TEST_CALL_DID_NOT_CONNECT_MESSAGE } from "./labels";
import { ACTIVE_TEST_CALL_MS, clearTestCalls, EMPTY_TRANSCRIPT_GRACE_MS, listAgentChoices, NETWORK_HOLD_MS, RESULT_TIMEOUT_MS, startTestCall, testCallResult } from "./test-call";

const KEY = "key_TESTCALLUNIT0123456789ab";
const AGENT = "agent_one";
const WEB = { access_token: "tok_web", call_id: "call_web_1", transport: "gateway", ice_servers: [{ urls: "stun:s.example" }], agent_id: AGENT };
const TUNING = { sleep: async () => {}, jitter: () => 0 };

let home: string;
let seen: { path: string; method: string }[];
let agents: unknown[];
let createAnswers: (() => Response)[];
let getAnswers: (() => Response)[];
let listAnswers: (() => Response)[];
let clock: number;
const now = () => clock;
const tuning = () => ({ ...TUNING, now });
const count = (p: string) => seen.filter((s) => s.path === p).length;

function endedRecord(callId = "call_web_1"): Record<string, unknown> {
  return { ...agentRecordOf(failedSample, callId, AGENT), call_status: "ended" };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-testcall-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  seen = [];
  clock = 1_000_000;
  agents = [{ agent_id: AGENT, agent_name: "Clinic line", channel: "voice" }];
  createAnswers = [];
  getAnswers = [];
  listAnswers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const p = new URL(String(input)).pathname;
      seen.push({ path: p, method: init?.method ?? "GET" });
      if (p === "/v2/list-agents") return (listAnswers.shift() ?? (() => Response.json({ items: agents, has_more: false })))();
      if (p === "/v3/create-web-call") return (createAnswers.shift() ?? (() => Response.json(WEB, { status: 201 })))();
      if (p.startsWith("/v2/get-call/")) return (getAnswers.shift() ?? (() => Response.json(endedRecord())))();
      return new Response("?", { status: 500 });
    }),
  );
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
  clearTestCalls();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
  clearTestCalls();
});

describe("listAgentChoices", () => {
  it("needs a stored key and makes no request without one", async () => {
    expect(await listAgentChoices({ tuning: tuning() })).toEqual({ ok: false, code: "not_connected" });
    expect(seen).toEqual([]);
  });

  it("lists id and name", async () => {
    await writeKey(KEY);
    expect(await listAgentChoices({ tuning: tuning() })).toEqual({ ok: true, agents: [{ id: AGENT, name: "Clinic line" }] });
  });

  it("reduces Retell's failures to codes", async () => {
    await writeKey(KEY);
    const cases: [number, string][] = [
      [401, "bad_key"],
      [403, "bad_key"],
      [429, "rate_limited"],
      [500, "retell_down"],
      [400, "network"],
    ];
    for (const [status, code] of cases) {
      listAnswers = Array.from({ length: 6 }, () => () => new Response("secret body", { status }));
      expect(await listAgentChoices({ tuning: tuning() }), String(status)).toEqual({ ok: false, code });
    }
  });
});

describe("startTestCall", () => {
  beforeEach(async () => {
    await writeKey(KEY);
  });

  it("answers only the four connection fields, after checking the agent against the fresh list", async () => {
    const res = await startTestCall(AGENT, { tuning: tuning() });
    expect(res).toEqual({ ok: true, call: { callId: "call_web_1", accessToken: "tok_web", transport: "gateway", iceServers: [{ urls: "stun:s.example" }] } });
    expect(seen.map((s) => s.path)).toEqual(["/v2/list-agents", "/v3/create-web-call"]);
  });

  it("refuses an id that is not an id shape, with no request at all", async () => {
    for (const id of ["../x", "a b", "", "x".repeat(129), 5, null, undefined, { a: 1 }, ["agent_one"]]) {
      expect(await startTestCall(id, { tuning: tuning() }), String(id)).toEqual({ ok: false, code: "bad_agent" });
    }
    expect(seen).toEqual([]);
  });

  it("refuses an agent that is not in the list, and never creates a call", async () => {
    expect(await startTestCall("agent_other", { tuning: tuning() })).toEqual({ ok: false, code: "bad_agent" });
    expect(count("/v3/create-web-call")).toBe(0);
    // The refusal does not keep the one-at-a-time slot.
    expect((await startTestCall(AGENT, { tuning: tuning() })).ok).toBe(true);
  });

  it("is not connected without a key, and makes no request", async () => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(home);
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "not_connected" });
    expect(seen).toEqual([]);
  });

  it("allows one active test call: a second start is call_active, with no Retell request", async () => {
    expect((await startTestCall(AGENT, { tuning: tuning() })).ok).toBe(true);
    const before = seen.length;
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "call_active" });
    expect(seen.length).toBe(before);
  });

  it("makes one create call when two starts arrive together", async () => {
    const [a, b] = await Promise.all([startTestCall(AGENT, { tuning: tuning() }), startTestCall(AGENT, { tuning: tuning() })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(count("/v3/create-web-call")).toBe(1);
  });

  it("frees the slot when the call fails to start", async () => {
    createAnswers = [() => new Response("x", { status: 401 })];
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "bad_key" });
    expect((await startTestCall(AGENT, { tuning: tuning() })).ok).toBe(true);
  });

  it("frees the slot after the timeout", async () => {
    expect((await startTestCall(AGENT, { tuning: tuning() })).ok).toBe(true);
    clock += ACTIVE_TEST_CALL_MS - 1;
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "call_active" });
    clock += 1;
    expect((await startTestCall(AGENT, { tuning: tuning() })).ok).toBe(true);
  });

  it("frees the slot when the call has ended (the result is asked for)", async () => {
    await startTestCall(AGENT, { tuning: tuning() });
    getAnswers = [() => Response.json({ ...endedRecord(), transcript_with_tool_calls: undefined })];
    expect(await testCallResult("call_web_1", { tuning: tuning() })).toEqual({ ok: true, result: { status: "processing" } });
    createAnswers = [() => Response.json({ ...WEB, call_id: "call_web_2" }, { status: 201 })];
    expect((await startTestCall(AGENT, { tuning: tuning() })).ok).toBe(true);
  });

  it("keeps the slot while the call is still going", async () => {
    await startTestCall(AGENT, { tuning: tuning() });
    getAnswers = [() => Response.json({ ...endedRecord(), call_status: "ongoing", transcript_with_tool_calls: undefined })];
    await testCallResult("call_web_1", { tuning: tuning() });
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "call_active" });
  });

  it("reduces Retell's errors to codes, and does not retry a create", async () => {
    const cases: [number, string][] = [
      [401, "bad_key"],
      [429, "rate_limited"],
      [500, "retell_down"],
      [404, "bad_agent"],
      [422, "bad_agent"],
    ];
    for (const [status, code] of cases) {
      const before = count("/v3/create-web-call");
      createAnswers = Array.from({ length: 6 }, () => () => new Response("secret body", { status }));
      expect(await startTestCall(AGENT, { tuning: tuning() }), String(status)).toEqual({ ok: false, code });
      expect(count("/v3/create-web-call") - before, `${status} retried`).toBe(1);
    }
  });

  it("refuses an answer it cannot read, as unreadable", async () => {
    createAnswers = [() => Response.json({ ...WEB, access_token: "" }, { status: 201 })];
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "unreadable" });
  });

  it("holds the slot for about 10 seconds after a network failure on the create, so an immediate retry makes no second call", async () => {
    createAnswers = [
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "network" });
    expect(count("/v3/create-web-call")).toBe(1);
    clock += NETWORK_HOLD_MS - 1;
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "call_active" });
    expect(count("/v3/create-web-call")).toBe(1);
    clock += 1;
    expect((await startTestCall(AGENT, { tuning: tuning() })).ok).toBe(true);
  });
});

describe("testCallResult", () => {
  beforeEach(async () => {
    await writeKey(KEY);
    await startTestCall(AGENT, { tuning: tuning() });
    seen = [];
  });

  it("refuses an id that is not an id shape, and a call this server did not start, with no request", async () => {
    expect(await testCallResult("../x", { tuning: tuning() })).toEqual({ ok: false, code: "bad_call_id" });
    expect(await testCallResult("call_other", { tuning: tuning() })).toEqual({ ok: false, code: "not_found" });
    expect(seen).toEqual([]);
  });

  it("is processing until the call has ended and its transcript with tool calls is there, then ready", async () => {
    const done = endedRecord();
    getAnswers = [
      () => Response.json({ ...done, call_status: "registered", transcript_with_tool_calls: undefined }),
      () => Response.json({ ...done, call_status: "ongoing" }),
      () => Response.json({ ...done, transcript_with_tool_calls: undefined }),
      () => Response.json(done),
    ];
    for (let i = 0; i < 3; i++) {
      clock += 5000;
      expect(await testCallResult("call_web_1", { tuning: tuning() }), `poll ${i}`).toEqual({ ok: true, result: { status: "processing" } });
    }
    const last = await testCallResult("call_web_1", { tuning: tuning() });
    expect(last).toEqual({ ok: true, result: { status: "ready", outcome: analyzeCall(done) } });
    expect(last.ok && last.result.status === "ready" && last.result.outcome.kind).toBe("report");
    expect(count("/v2/get-call/call_web_1")).toBe(4);
  });

  it("waits up to 30 seconds after the call ended for an empty transcript to fill, then gives the engine's no_content", async () => {
    const quiet = { ...endedRecord(), transcript_with_tool_calls: [], transcript: "" };
    getAnswers = [() => Response.json(quiet), () => Response.json(quiet)];
    expect(await testCallResult("call_web_1", { tuning: tuning() })).toEqual({ ok: true, result: { status: "processing" } });
    clock += EMPTY_TRANSCRIPT_GRACE_MS;
    const res = await testCallResult("call_web_1", { tuning: tuning() });
    expect(res).toEqual({ ok: true, result: { status: "ready", outcome: analyzeCall(quiet) } });
    expect(res.ok && res.result.status === "ready" && res.result.outcome.kind).toBe("no_content");
  });

  it("gives the report when an empty transcript fills within 30 seconds", async () => {
    const done = endedRecord();
    getAnswers = [() => Response.json({ ...done, transcript_with_tool_calls: [] }), () => Response.json(done)];
    expect(await testCallResult("call_web_1", { tuning: tuning() })).toEqual({ ok: true, result: { status: "processing" } });
    clock += EMPTY_TRANSCRIPT_GRACE_MS - 1;
    const res = await testCallResult("call_web_1", { tuning: tuning() });
    expect(res).toEqual({ ok: true, result: { status: "ready", outcome: analyzeCall(done) } });
    expect(res.ok && res.result.status === "ready" && res.result.outcome.kind).toBe("report");
  });

  it("never times out a live call and keeps the slot, however long it is polled", async () => {
    const live = () => Response.json({ ...endedRecord(), call_status: "ongoing", transcript_with_tool_calls: undefined });
    getAnswers = Array.from({ length: 40 }, () => live);
    for (let i = 0; i < 36; i++) {
      expect(await testCallResult("call_web_1", { tuning: tuning() }), `poll ${i}`).toEqual({ ok: true, result: { status: "processing" } });
      clock += 5000;
    }
    expect(clock - 1_000_000).toBeGreaterThanOrEqual(3 * 60 * 1000);
    expect(await startTestCall(AGENT, { tuning: tuning() })).toEqual({ ok: false, code: "call_active" });
  });

  it("counts the 2 minute wait from when the call ended, not from the first ask", async () => {
    const live = () => Response.json({ ...endedRecord(), call_status: "ongoing", transcript_with_tool_calls: undefined });
    const pending = () => Response.json({ ...endedRecord(), transcript_with_tool_calls: undefined });
    getAnswers = [live, pending, pending];
    await testCallResult("call_web_1", { tuning: tuning() });
    clock += 5 * 60 * 1000;
    expect(await testCallResult("call_web_1", { tuning: tuning() })).toEqual({ ok: true, result: { status: "processing" } });
    clock += RESULT_TIMEOUT_MS;
    const late = await testCallResult("call_web_1", { tuning: tuning() });
    expect(late.ok && late.result.status).toBe("timeout");
  });

  it("answers at once, and frees the slot, for a call that ended in error or never connected", async () => {
    for (const status of ["error", "not_connected"]) {
      clearTestCalls();
      createAnswers = [() => Response.json(WEB, { status: 201 })];
      expect((await startTestCall(AGENT, { tuning: tuning() })).ok, status).toBe(true);
      getAnswers = [() => Response.json({ ...endedRecord(), call_status: status, transcript_with_tool_calls: undefined })];
      const res = await testCallResult("call_web_1", { tuning: tuning() });
      expect(res.ok && res.result.status, status).toBe("did_not_connect");
      expect(res.ok && res.result.status === "did_not_connect" && res.result.message).toBe(TEST_CALL_DID_NOT_CONNECT_MESSAGE);
      createAnswers = [() => Response.json({ ...WEB, call_id: "call_web_2" }, { status: 201 })];
      expect((await startTestCall(AGENT, { tuning: tuning() })).ok, `${status} slot`).toBe(true);
    }
  });

  it("makes one Retell request for polls of one call that arrive together", async () => {
    getAnswers = [() => Response.json({ ...endedRecord(), call_status: "ongoing" })];
    const [a, b, c] = await Promise.all([testCallResult("call_web_1", { tuning: tuning() }), testCallResult("call_web_1", { tuning: tuning() }), testCallResult("call_web_1", { tuning: tuning() })]);
    expect(count("/v2/get-call/call_web_1")).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    // The next ask, after those, is a new request.
    getAnswers = [() => Response.json({ ...endedRecord(), call_status: "ongoing" })];
    await testCallResult("call_web_1", { tuning: tuning() });
    expect(count("/v2/get-call/call_web_1")).toBe(2);
  });

  it("answers a plain message once about two minutes of processing have passed, and ready later if the call completes", async () => {
    const processing = () => Response.json({ ...endedRecord(), transcript_with_tool_calls: undefined });
    getAnswers = [processing, processing, processing, () => Response.json(endedRecord())];
    expect(await testCallResult("call_web_1", { tuning: tuning() })).toEqual({ ok: true, result: { status: "processing" } });
    clock += RESULT_TIMEOUT_MS - 1;
    expect(await testCallResult("call_web_1", { tuning: tuning() })).toEqual({ ok: true, result: { status: "processing" } });
    clock += 1;
    const late = await testCallResult("call_web_1", { tuning: tuning() });
    expect(late.ok && late.result.status).toBe("timeout");
    expect(late.ok && late.result.status === "timeout" && late.result.message).toMatch(/Retell/);
    // The slot is free once the wait is over.
    createAnswers = [() => Response.json({ ...WEB, call_id: "call_web_2" }, { status: 201 })];
    expect((await startTestCall(AGENT, { tuning: tuning() })).ok).toBe(true);
    const ready = await testCallResult("call_web_1", { tuning: tuning() });
    expect(ready.ok && ready.result.status).toBe("ready");
  });

  it("makes one request per ask, never a loop", async () => {
    getAnswers = [() => Response.json({ ...endedRecord(), call_status: "ongoing" })];
    await testCallResult("call_web_1", { tuning: tuning() });
    expect(count("/v2/get-call/call_web_1")).toBe(1);
  });

  it("reduces Retell's errors to codes", async () => {
    const cases: [number, string][] = [
      [401, "bad_key"],
      [404, "not_found"],
      [429, "rate_limited"],
      [500, "retell_down"],
    ];
    for (const [status, code] of cases) {
      getAnswers = Array.from({ length: 6 }, () => () => new Response("secret body", { status }));
      expect(await testCallResult("call_web_1", { tuning: tuning() }), String(status)).toEqual({ ok: false, code });
    }
  });

  it("refuses a record for another call, as unreadable", async () => {
    getAnswers = [() => Response.json(endedRecord("call_someone_else"))];
    expect(await testCallResult("call_web_1", { tuning: tuning() })).toEqual({ ok: false, code: "unreadable" });
  });

  it("never lets the stored key out in an outcome: a call that holds it is answered as an error", async () => {
    const rec = endedRecord() as { transcript_with_tool_calls: { content?: string }[] };
    const turn = rec.transcript_with_tool_calls.find((u) => typeof u.content === "string" && u.content !== "");
    if (!turn) throw new Error("the sample has no spoken turn");
    turn.content = `${turn.content} my key is ${KEY} ok`;
    getAnswers = [() => Response.json(rec)];
    const res = await testCallResult("call_web_1", { tuning: tuning() });
    expect(JSON.stringify(res)).not.toContain(KEY);
    expect(res.ok && res.result.status === "ready" && res.result.outcome.kind).toBe("error");
  });
});
