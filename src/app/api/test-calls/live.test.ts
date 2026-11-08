// @vitest-environment node
// GET /api/test-calls/{callId}/live: the route in front of the live transcript relay. Retell's REST side is a fake fetch and the
// monitor socket is a real local WebSocket server (src/pull/fake-monitor.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeKey } from "@/pull/key-store";
import { startFakeMonitor, type FakeConnection, type FakeMonitor } from "@/pull/fake-monitor";
import { clearTestCalls, startTestCall } from "@/pull/test-call";
import { GET } from "./[callId]/live/route";

const KEY = "key_LIVEROUTE0123456789abcd";
const HOST = "localhost:3000";
const AGENT = "agent_one";
const CALL = "call_web_1";
const WEB = { access_token: "tok_web", call_id: CALL, transport: "gateway", ice_servers: [], agent_id: AGENT };

let home: string;
let monitor: FakeMonitor;
let requests: string[];
let script: (conn: FakeConnection) => void;

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-liveroute-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
  requests = [];
  script = (conn) => {
    conn.send({ type: "transcript_snapshot", transcripts: [{ id: "u1", role: "agent", content: "Hello there.", time_sec: 0.5 }] });
    conn.send({ type: "call_ended" });
  };
  monitor = await startFakeMonitor((conn) => script(conn));
  vi.stubEnv("OVERHEAR_RETELL_BASE_URL", monitor.origin);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const p = new URL(String(input)).pathname;
      requests.push(p);
      if (p === "/v2/list-agents") return Response.json({ items: [{ agent_id: AGENT, agent_name: "Clinic line", channel: "voice" }], has_more: false });
      if (p === "/v3/create-web-call") return Response.json(WEB, { status: 201 });
      return new Response("no", { status: 500 });
    }),
  );
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
  clearTestCalls();
});
afterEach(async () => {
  clearTestCalls();
  await monitor.stop();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});

const ctx = (callId: string) => ({ params: Promise.resolve({ callId }) });
const ask = (id = CALL, headers: Record<string, string> = {}, signal?: AbortSignal) =>
  GET(new Request(`http://localhost:3000/api/test-calls/${id}/live`, { method: "GET", headers: { host: HOST, ...headers }, signal }), ctx(id));
async function begin() {
  await writeKey(KEY);
  expect((await startTestCall(AGENT)).ok).toBe(true);
}

describe("GET /api/test-calls/{callId}/live", () => {
  it("answers 404 on a hosted copy, with no socket opened", async () => {
    await begin();
    vi.stubEnv("OVERHEAR_LOCAL", "");
    expect((await ask()).status).toBe(404);
    expect(monitor.connections).toHaveLength(0);
  });

  it("refuses a read from another site or another port (403), as a fetch, an EventSource or a page", async () => {
    await begin();
    for (const site of ["cross-site", "same-site"]) {
      for (const dest of ["empty", "document", "script"]) {
        expect((await ask(CALL, { "sec-fetch-site": site, "sec-fetch-dest": dest })).status, `${site} ${dest}`).toBe(403);
      }
    }
    expect((await ask(CALL, { host: "evil.com" })).status).toBe(403);
    expect(monitor.connections).toHaveLength(0);
  });

  it("is 404 for a call this server did not start, and 400 for an id that is not a call id", async () => {
    await begin();
    const unknown = await ask("call_other");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "not_found" });
    expect((await ask("a.b")).status).toBe(400);
    expect(monitor.connections).toHaveLength(0);
  });

  it("is 404 after a Disconnect, which forgets every call", async () => {
    await begin();
    clearTestCalls();
    expect((await ask()).status).toBe(404);
  });

  it("streams the call's words as text/event-stream with no-store and anti-framing headers, then closes", async () => {
    await begin();
    const res = await ask(CALL, { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const text = await res.text();
    expect(text).toContain('event: utterance\ndata: {"id":"u1","role":"agent","content":"Hello there.","time_sec":0.5}\n\n');
    expect(text).toContain("event: end\ndata: {}\n\n");
    expect(text).not.toContain(KEY);
    expect(monitor.connections[0].protocols).toEqual(["bearer", KEY]);
  });

  it("closes the monitor socket when the request aborts", async () => {
    script = () => {};
    await begin();
    const abort = new AbortController();
    const res = await ask(CALL, {}, abort.signal);
    const reader = res.body!.getReader();
    await reader.read();
    const stop = Date.now() + 3000;
    while (monitor.connections.length === 0 && Date.now() < stop) await new Promise((r) => setTimeout(r, 10));
    expect(monitor.connections).toHaveLength(1);
    abort.abort();
    await monitor.connections[0].closed;
  });

  it("refuses a second stream for the same call while the first is open (409)", async () => {
    script = () => {};
    await begin();
    const first = await ask();
    expect(first.status).toBe(200);
    const second = await ask();
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "already_open" });
    await first.body!.cancel();
  });
});
