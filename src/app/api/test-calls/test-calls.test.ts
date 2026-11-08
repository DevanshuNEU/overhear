// @vitest-environment node
// The agent list and test call routes: GET /api/agents, POST /api/test-calls and GET /api/test-calls/{callId}/result. The
// key is stored on a temp home and Retell is a fake fetch that counts requests by path.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRecordOf } from "@/pinned/testing";
import { failedSample } from "@/report/samples";
import { analyzeCall } from "@/pull/analyzer";
import { writeKey } from "@/pull/key-store";
import { clearTestCalls } from "@/pull/test-call";
import { GET as agentsGet } from "../agents/route";
import { DELETE as disconnect } from "../connect/route";
import { GET as resultGet } from "./[callId]/result/route";
import { POST as releasePost } from "./[callId]/release/route";
import { POST } from "./route";

const KEY = "key_TCROUTE0123456789abcdef";
const MARKER = "TCMARKER7d1e5b";
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;
const AGENT = "agent_one";
const CALL = "call_web_1";
const WEB = { access_token: "tok_web", call_id: CALL, transport: "gateway", ice_servers: [{ urls: "stun:s.example" }], agent_id: AGENT, retell_llm_dynamic_variables: { a: MARKER } };

let home: string;
let requests: string[];
let retell: (path: string) => Response;

const count = (p: string) => requests.filter((r) => r === p).length;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-tcroutes-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
  requests = [];
  retell = (p) => {
    if (p === "/v2/list-agents") {
      const agent = (id: string, name: string) => ({ agent_id: id, agent_name: name, channel: "voice", response_engine: { llm_id: MARKER }, webhook_url: `https://h.example/${MARKER}` });
      return Response.json({ items: [agent("agent_z", "Zed"), agent(AGENT, "Clinic line")], has_more: false });
    }
    if (p === "/v3/create-web-call") return Response.json(WEB, { status: 201 });
    if (p.startsWith("/v2/get-call/")) return Response.json({ ...agentRecordOf(failedSample, CALL, AGENT), call_status: "ended" });
    return new Response("no", { status: 500 });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const p = new URL(String(input)).pathname;
      requests.push(p);
      return retell(p);
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

const send = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${p}`, {
    method,
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (callId: string) => ({ params: Promise.resolve({ callId }) });
const read = async (res: Response) => ({ status: res.status, text: await res.clone().text(), body: (await res.json()) as Record<string, unknown>, res });
const start = (body: unknown = { agentId: AGENT }, headers: Record<string, string> = {}) => POST(send("POST", "/api/test-calls", body, headers));
const release = (id = CALL, headers: Record<string, string> = {}) => releasePost(send("POST", `/api/test-calls/${id}/release`, undefined, headers), ctx(id));
const result = (id = CALL, headers: Record<string, string> = {}) => resultGet(send("GET", `/api/test-calls/${id}/result`, undefined, headers), ctx(id));

describe("local mode only", () => {
  it("answers 404 on every route when OVERHEAR_LOCAL is unset, with no Retell request", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    await writeKey(KEY);
    expect((await agentsGet(send("GET", "/api/agents"))).status).toBe(404);
    expect((await start()).status).toBe(404);
    expect((await result()).status).toBe(404);
    expect((await release()).status).toBe(404);
    expect(requests).toEqual([]);
  });

  it("refuses a foreign host and a POST without a same-origin Origin (403), with no Retell request", async () => {
    await writeKey(KEY);
    expect((await agentsGet(send("GET", "/api/agents", undefined, { host: "evil.com" }))).status).toBe(403);
    expect((await start({ agentId: AGENT }, { host: "evil.com" })).status).toBe(403);
    expect((await start({ agentId: AGENT }, { origin: "http://evil.com" })).status).toBe(403);
    expect((await start({ agentId: AGENT }, { origin: "null" })).status).toBe(403);
    expect((await result(CALL, { host: "evil.com" })).status).toBe(403);
    expect((await release(CALL, { host: "evil.com" })).status).toBe(403);
    expect((await release(CALL, { origin: "http://evil.com" })).status).toBe(403);
    expect((await release(CALL, { origin: "null" })).status).toBe(403);
    expect(requests).toEqual([]);
  });

  it("refuses a GET another site or another port sends, as a fetch or as a page (403), with no Retell request", async () => {
    await writeKey(KEY);
    for (const site of ["cross-site", "same-site"]) {
      for (const dest of ["empty", "document", "script"]) {
        const h = { "sec-fetch-site": site, "sec-fetch-dest": dest };
        expect((await agentsGet(send("GET", "/api/agents", undefined, h))).status, `agents ${site} ${dest}`).toBe(403);
        expect((await result(CALL, h)).status, `result ${site} ${dest}`).toBe(403);
      }
    }
    expect(requests).toEqual([]);
    expect((await agentsGet(send("GET", "/api/agents", undefined, { "sec-fetch-site": "same-origin" }))).status).toBe(200);
  });
});

describe("GET /api/agents", () => {
  it("answers id and name only, sorted by name, from the stored key", async () => {
    await writeKey(KEY);
    const r = await read(await agentsGet(send("GET", "/api/agents")));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ agents: [{ id: AGENT, name: "Clinic line" }, { id: "agent_z", name: "Zed" }] });
    expect(r.text).not.toContain(MARKER);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(r.res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("is 409 not_connected without a key, and makes no request", async () => {
    const r = await read(await agentsGet(send("GET", "/api/agents")));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("not_connected");
    expect(requests).toEqual([]);
  });

  it("reduces Retell's errors to a code and a fixed sentence", async () => {
    await writeKey(KEY);
    retell = () => new Response(JSON.stringify({ message: `bad ${MARKER} ${KEY}` }), { status: 401 });
    const r = await read(await agentsGet(send("GET", "/api/agents")));
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("bad_key");
    expect(r.text).not.toContain(MARKER);
    expect(r.text).not.toContain(KEY);
  });
});

describe("POST /api/test-calls", () => {
  it("answers only callId, accessToken, transport and iceServers", async () => {
    await writeKey(KEY);
    const r = await read(await start());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ callId: CALL, accessToken: "tok_web", transport: "gateway", iceServers: [{ urls: "stun:s.example" }] });
    expect(r.text).not.toContain(MARKER);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(count("/v3/create-web-call")).toBe(1);
  });

  it("refuses a malformed agent id, an unknown agent and a bad body (400) and never creates a call", async () => {
    await writeKey(KEY);
    for (const body of [{ agentId: "../etc" }, { agentId: "a b" }, { agentId: "" }, { agentId: 5 }, { agentId: ["agent_one"] }, {}, { agentId: AGENT, extra: 1 }, [AGENT], "null", "5", "{ not json"]) {
      const r = await read(await start(body));
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(["bad_agent", "bad_request"]).toContain(r.body.error);
    }
    const unknown = await read(await start({ agentId: "agent_not_mine" }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("bad_agent");
    expect(count("/v3/create-web-call")).toBe(0);
    // No refusal holds the one-at-a-time slot.
    expect((await start()).status).toBe(200);
  });

  it("makes no Retell request at all for a malformed id", async () => {
    await writeKey(KEY);
    await start({ agentId: "../x" });
    expect(requests).toEqual([]);
  });

  it("refuses a body not declared as JSON (415) or over 1 KB (413), without a request", async () => {
    await writeKey(KEY);
    expect((await start({ agentId: AGENT }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await start({ agentId: AGENT, pad: "x".repeat(2000) })).status).toBe(413);
    expect(requests).toEqual([]);
  });

  it("stops reading a body past 1 KB when it has no Content-Length (413)", async () => {
    await writeKey(KEY);
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(512));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 5000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost:3000/api/test-calls", { method: "POST", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    expect(req.headers.get("content-length")).toBeNull();
    const r = await read(await POST(req));
    expect(r.status).toBe(413);
    expect(pulled).toBeLessThan(20);
    expect(requests).toEqual([]);
  });

  it("is 409 not_connected without a key", async () => {
    const r = await read(await start());
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("not_connected");
    expect(requests).toEqual([]);
  });

  it("allows one test call at a time: the second start is 409 call_active and makes no request", async () => {
    await writeKey(KEY);
    expect((await start()).status).toBe(200);
    const before = requests.length;
    const r = await read(await start());
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("call_active");
    expect(requests.length).toBe(before);
  });

  it("frees the slot once the result says the call has ended", async () => {
    await writeKey(KEY);
    await start();
    expect((await result()).status).toBe(200);
    const base = retell;
    retell = (p) => (p === "/v3/create-web-call" ? Response.json({ ...WEB, call_id: "call_web_2" }, { status: 201 }) : base(p));
    expect((await start()).status).toBe(200);
  });

  it("forgets the call and frees the slot on Disconnect", async () => {
    await writeKey(KEY);
    expect((await start()).status).toBe(200);
    expect((await disconnect(send("DELETE", "/api/connect"))).status).toBe(200);
    await writeKey(KEY);
    expect((await result()).status).toBe(404);
    expect((await start()).status).toBe(200);
  });

  it("reduces Retell's errors to codes and fixed sentences, never what Retell said", async () => {
    await writeKey(KEY);
    const base = retell;
    for (const [status, error, http] of [[401, "bad_key", 502], [429, "rate_limited", 429], [500, "retell_down", 502], [422, "bad_agent", 400]] as const) {
      retell = (p) => (p === "/v3/create-web-call" ? new Response(JSON.stringify({ message: `no ${MARKER} ${KEY}` }), { status }) : base(p));
      const r = await read(await start());
      expect(r.status, String(status)).toBe(http);
      expect(r.body.error).toBe(error);
      expect(typeof r.body.message).toBe("string");
      expect(r.text).not.toContain(MARKER);
      expect(r.text).not.toContain(KEY);
    }
  });
});

describe("GET /api/test-calls/{callId}/result", () => {
  it("refuses a call id that is not an id shape (400), and a call this server did not start (404), without a request", async () => {
    await writeKey(KEY);
    const bad = await read(await result("has space"));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("bad_call_id");
    const dots = await read(await result("x".repeat(129)));
    expect(dots.status).toBe(400);
    const unknown = await read(await result("call_not_started"));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("not_found");
    expect(requests).toEqual([]);
  });

  it("answers processing, then ready with the engine's outcome", async () => {
    await writeKey(KEY);
    await start();
    const done = { ...agentRecordOf(failedSample, CALL, AGENT), call_status: "ended" };
    const base = retell;
    retell = (p) => (p.startsWith("/v2/get-call/") ? Response.json({ ...done, call_status: "ongoing", transcript_with_tool_calls: undefined }) : base(p));
    const waiting = await read(await result());
    expect(waiting.status).toBe(200);
    expect(waiting.body).toEqual({ status: "processing" });
    retell = base;
    const ready = await read(await result());
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("ready");
    expect(ready.body.outcome).toEqual(JSON.parse(JSON.stringify(analyzeCall(done))));
    expect((ready.body.outcome as { kind: string }).kind).toBe("report");
    expect(ready.res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a plain message after about two minutes of processing", async () => {
    await writeKey(KEY);
    await start();
    const base = retell;
    retell = (p) => (p.startsWith("/v2/get-call/") ? Response.json({ ...agentRecordOf(failedSample, CALL, AGENT), call_status: "ended", transcript_with_tool_calls: undefined }) : base(p));
    const t0 = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(t0);
    expect((await read(await result())).body).toEqual({ status: "processing" });
    spy.mockReturnValue(t0 + 2 * 60 * 1000 + 1);
    const late = await read(await result());
    expect(late.status).toBe(200);
    expect(late.body.status).toBe("timeout");
    expect(typeof late.body.message).toBe("string");
    spy.mockRestore();
  });

  it("reduces Retell's errors to codes", async () => {
    await writeKey(KEY);
    await start();
    const base = retell;
    retell = (p) => (p.startsWith("/v2/get-call/") ? new Response(JSON.stringify({ message: `x ${MARKER} ${KEY}` }), { status: 404 }) : base(p));
    const r = await read(await result());
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("not_found");
    expect(r.text).not.toContain(MARKER);
    expect(r.text).not.toContain(KEY);
  });
});

describe("POST /api/test-calls/{callId}/release", () => {
  it("frees the slot of a call this server started, so the next start goes through, with no Retell request", async () => {
    await writeKey(KEY);
    await start();
    const before = requests.length;
    const r = await read(await release());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ released: true });
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(r.res.headers.get("x-frame-options")).toBe("DENY");
    expect(requests.length).toBe(before);
    const base = retell;
    retell = (p) => (p === "/v3/create-web-call" ? Response.json({ ...WEB, call_id: "call_web_2" }, { status: 201 }) : base(p));
    expect((await start()).status).toBe(200);
  });

  it("says nothing was held when the slot was already free", async () => {
    await writeKey(KEY);
    await start();
    await release();
    expect((await read(await release())).body).toEqual({ released: false });
  });

  it("refuses an id that is not an id shape (400) and a call this server did not start (404), without a request", async () => {
    await writeKey(KEY);
    const bad = await read(await release("..%2Fx"));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("bad_call_id");
    const unknown = await read(await release("call_unknown"));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("not_found");
    expect(requests).toEqual([]);
  });

  it("answers no GET, so a page on another site cannot read or probe it", async () => {
    const mod = (await import("./[callId]/release/route")) as Record<string, unknown>;
    expect(mod.GET).toBeUndefined();
  });
});
