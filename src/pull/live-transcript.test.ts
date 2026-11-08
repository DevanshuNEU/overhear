// @vitest-environment node
// The live transcript relay: a fake monitor socket (a real local WebSocket server) stands in for Retell, and the stream the
// screen would read is read back as Server-Sent Events. Retell's REST side is a fake fetch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeKey, removeKey } from "./key-store";
import { startFakeMonitor, type FakeMonitor } from "./fake-monitor";
import { clearPulls } from "./pull";
import { TEST_CALL_MESSAGE } from "./labels";
import { openLiveTranscript, utterancesOf, type LiveDeps } from "./live-transcript";
import { clearTestCalls, startTestCall } from "./test-call";

const KEY = "key_LIVERELAY0123456789abcd";
const AGENT = "agent_one";
const CALL = "call_web_1";
const WEB = { access_token: "tok_web", call_id: CALL, transport: "gateway", ice_servers: [], agent_id: AGENT };
const FAST: LiveDeps = { retryDelayMs: () => 5, watchMs: 20 };

let home: string;
let monitor: FakeMonitor | undefined;
let logs: unknown[][];

const agent = (id: string, role: "agent" | "user", content: string, time_sec: number, extra: Record<string, unknown> = {}) => ({ id, role, content, time_sec, ...extra });
const snapshot = (...transcripts: unknown[]) => ({ type: "transcript_snapshot", transcripts, pre_session_transcripts: [] });
const updated = (...transcripts: unknown[]) => ({ type: "transcript_updated", transcripts });

/** Reads the stream as events. `next` gives the next event, or null when the stream has closed. Comments are skipped. */
function reader(body: ReadableStream<Uint8Array>) {
  const r = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const raw: string[] = [];
  async function next(): Promise<{ name: string; data: unknown } | null> {
    for (;;) {
      const at = buffer.indexOf("\n\n");
      if (at >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        raw.push(block);
        if (block.startsWith(":")) continue;
        const name = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
        const data = /^data: (.*)$/m.exec(block)?.[1];
        return { name, data: data === undefined ? undefined : JSON.parse(data) };
      }
      const chunk = await Promise.race([r.read(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("stream stalled")), 5000))]);
      if (chunk.done) return null;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }
  async function all(): Promise<{ name: string; data: unknown }[]> {
    const out = [];
    for (let e = await next(); e !== null; e = await next()) out.push(e);
    return out;
  }
  return { next, all, raw, cancel: () => r.cancel() };
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const stop = Date.now() + ms;
  while (!check()) {
    if (Date.now() > stop) throw new Error("condition not met");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function begin(onConnect?: Parameters<typeof startFakeMonitor>[0]) {
  monitor = await startFakeMonitor(onConnect);
  vi.stubEnv("OVERHEAR_RETELL_BASE_URL", monitor.origin);
  await writeKey(KEY);
  const started = await startTestCall(AGENT);
  expect(started.ok).toBe(true);
}

async function open(deps: LiveDeps = FAST, signal: AbortSignal = new AbortController().signal) {
  const res = await openLiveTranscript(CALL, signal, deps);
  if (!res.ok) throw new Error(`refused: ${res.code}`);
  return reader(res.body);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-live-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const p = new URL(String(input)).pathname;
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
  await monitor?.stop();
  monitor = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});

describe("what the relay says to Retell", () => {
  it("opens the monitor path of the call with the bearer subprotocols and the stored key", async () => {
    await begin();
    const stream = await open();
    await until(() => monitor!.connections.length === 1);
    expect(monitor!.connections[0].path).toBe(`/v2/monitor-call/${CALL}`);
    expect(monitor!.connections[0].protocols).toEqual(["bearer", KEY]);
    await stream.cancel();
  });
});

describe("what the stream carries", () => {
  it("passes each utterance once, as snapshots and updates repeat and extend it, then ends with the call", async () => {
    await begin((conn) => {
      conn.send(snapshot(agent("u1", "agent", "Hello, Northwind.", 0.4)));
      conn.send(updated(agent("u1", "agent", "Hello, Northwind. How can I help?", 0.4), agent("u2", "user", "I need an appointment", 3.1)));
      conn.send(updated(agent("u2", "user", "I need an appointment", 3.1)));
      conn.send({ type: "call_ended", disconnection_reason: "user_hangup" });
    });
    const events = await (await open()).all();
    expect(events).toEqual([
      { name: "utterance", data: { id: "u1", role: "agent", content: "Hello, Northwind.", time_sec: 0.4 } },
      { name: "utterance", data: { id: "u1", role: "agent", content: "Hello, Northwind. How can I help?", time_sec: 0.4 } },
      { name: "utterance", data: { id: "u2", role: "user", content: "I need an appointment", time_sec: 3.1 } },
      { name: "end", data: {} },
    ]);
  });

  it("drops tool payloads, node transitions, other roles, pre-session history, other frames and every extra field", async () => {
    await begin((conn) => {
      conn.send({
        type: "transcript_snapshot",
        transcripts: [
          { id: "t1", role: "tool_call_invocation", name: "book", arguments: '{"secret":"x"}', tool_call_id: "c1", time_sec: 1 },
          { id: "t2", role: "tool_call_result", tool_call_id: "c1", content: "TOOLRESULT", successful: true, time_sec: 2 },
          { id: "t3", role: "node_transition", former_node_id: "a", former_node_name: "A", new_node_id: "b", new_node_name: "B", time_sec: 3 },
          { id: "t4", role: "dtmf", digit: "5", time_sec: 4 },
          { id: "t5", role: "injected", content: "INJECTED", time_sec: 5 },
          { id: "t6", role: "sms", content: "SMS", time_sec: 6 },
          agent("a1", "agent", "Kept agent", 7, { words: [{ word: "Kept", start: 7 }], metadata: { llm: "x" }, tool_call_id: "zzz" }),
          { id: "a2", role: "user", content: 42, time_sec: 8 },
          { role: "user", content: "no id", time_sec: 9 },
        ],
        pre_session_transcripts: [agent("p1", "user", "PRESESSION", 0)],
      });
      conn.send({ type: "something_new", transcripts: [agent("n1", "agent", "NEWTYPE", 1)] });
      conn.sendRaw("not json");
      conn.sendRaw("[1,2]");
      conn.send(updated(agent("u9", "user", "Caller words", 10)));
      conn.close(1000);
    });
    const stream = await open();
    const events = await stream.all();
    expect(events).toEqual([
      { name: "utterance", data: { id: "a1", role: "agent", content: "Kept agent", time_sec: 7 } },
      { name: "utterance", data: { id: "u9", role: "user", content: "Caller words", time_sec: 10 } },
      { name: "end", data: {} },
    ]);
    const text = stream.raw.join("\n");
    for (const word of ["TOOLRESULT", "INJECTED", "SMS", "PRESESSION", "NEWTYPE", "secret", "llm", '"words"']) expect(text).not.toContain(word);
  });

  it("maps a caller role to user and drops an utterance that holds the key", () => {
    const out = utterancesOf(
      [
        { id: "c1", role: "caller", content: "Hi", time_sec: 1 },
        { id: "c2", role: "user", content: `my key is ${KEY}`, time_sec: 2 },
        { id: `x${KEY}`, role: "agent", content: "fine", time_sec: 3 },
        { id: "c3", role: "agent", content: "ok", time_sec: Number.NaN },
      ],
      KEY,
    );
    expect(out).toEqual([{ id: "c1", role: "user", content: "Hi", time_sec: 1 }]);
  });
});

describe("when the upstream socket closes", () => {
  it("closes it, and frees the call for a new stream, when the call ends", async () => {
    await begin((conn) => conn.send({ type: "call_ended" }));
    const events = await (await open()).all();
    expect(events).toEqual([{ name: "end", data: {} }]);
    await monitor!.connections[0].closed;
    const again = await openLiveTranscript(CALL, new AbortController().signal, FAST);
    expect(again.ok).toBe(true);
    if (again.ok) await again.body.cancel();
  });

  it("closes it when the page disconnects (the request aborts)", async () => {
    await begin();
    const abort = new AbortController();
    const stream = await open(FAST, abort.signal);
    await until(() => monitor!.connections.length === 1);
    abort.abort();
    await monitor!.connections[0].closed;
    expect(await stream.next()).toBeNull();
  });

  it("closes it when the response is cancelled", async () => {
    await begin();
    const stream = await open();
    await until(() => monitor!.connections.length === 1);
    await stream.cancel();
    await monitor!.connections[0].closed;
  });

  it("closes it, and tells the screen, when the key is disconnected or replaced (the epoch changes)", async () => {
    await begin();
    const stream = await open();
    await until(() => monitor!.connections.length === 1);
    clearPulls();
    expect(await stream.all()).toEqual([{ name: "problem", data: { error: "not_connected", message: TEST_CALL_MESSAGE.not_connected } }]);
    await monitor!.connections[0].closed;
  });

  it("closes it at once on Disconnect, which clears the test calls", async () => {
    await begin();
    const stream = await open({ ...FAST, watchMs: 60_000 });
    await until(() => monitor!.connections.length === 1);
    clearTestCalls();
    expect(await stream.all()).toEqual([{ name: "problem", data: { error: "not_connected", message: TEST_CALL_MESSAGE.not_connected } }]);
    await monitor!.connections[0].closed;
  });

  it("closes it after the call's cap", async () => {
    await begin();
    const stream = await open({ ...FAST, capMs: 80 });
    await until(() => monitor!.connections.length === 1);
    expect(await stream.all()).toEqual([{ name: "end", data: {} }]);
    await monitor!.connections[0].closed;
  });

  it("ends at once when the cap is already past", async () => {
    await begin();
    const stream = await open({ ...FAST, now: () => Date.now() + 16 * 60 * 1000 });
    expect(await stream.all()).toEqual([{ name: "end", data: {} }]);
  });

  it("ends when Retell closes normally", async () => {
    await begin((conn) => conn.close(1000));
    expect(await (await open()).all()).toEqual([{ name: "end", data: {} }]);
  });
});

describe("a call that is not live yet, and a lost connection", () => {
  it("tries again after Retell says the call is not live (4004), and then streams", async () => {
    await begin((conn, i) => {
      if (i < 2) return conn.close(4004);
      conn.send(snapshot(agent("u1", "agent", "Hi", 0.2)));
      conn.send({ type: "call_ended" });
    });
    const events = await (await open()).all();
    expect(events.map((e) => e.name)).toEqual(["utterance", "end"]);
    expect(monitor!.connections).toHaveLength(3);
  });

  it("opens the socket again after a lost connection, and does not repeat what it passed on", async () => {
    await begin((conn, i) => {
      conn.send(snapshot(agent("u1", "agent", "Hi", 0.2)));
      if (i === 0) setTimeout(() => conn.close(1006), 20);
      else conn.send({ type: "call_ended" });
    });
    const events = await (await open()).all();
    expect(events.map((e) => e.name)).toEqual(["utterance", "end"]);
    expect(monitor!.connections).toHaveLength(2);
  });

  it("gives up with a fixed code after repeated 4004s", async () => {
    await begin((conn) => conn.close(4004));
    const stream = await open();
    const events = await stream.all();
    expect(events).toEqual([{ name: "problem", data: { error: "network", message: TEST_CALL_MESSAGE.network } }]);
    expect(monitor!.connections).toHaveLength(8);
  });

  it("gives up with a fixed code on another rejection, and keeps nothing Retell said", async () => {
    await begin((conn) => conn.close(4001));
    const events = await (await open()).all();
    expect(events).toEqual([{ name: "problem", data: { error: "failed", message: TEST_CALL_MESSAGE.failed } }]);
  });

  it("gives up with a fixed code when the socket cannot be opened at all", async () => {
    await begin();
    await monitor!.stop();
    const events = await (await open()).all();
    expect(events).toEqual([{ name: "problem", data: { error: "network", message: TEST_CALL_MESSAGE.network } }]);
  });
});

describe("guards", () => {
  it("allows one stream per call, and answers the second with already_open", async () => {
    await begin();
    const first = await open();
    const second = await openLiveTranscript(CALL, new AbortController().signal, FAST);
    expect(second).toEqual({ ok: false, code: "already_open" });
    await until(() => monitor!.connections.length === 1);
    await first.cancel();
    await monitor!.connections[0].closed;
    const third = await openLiveTranscript(CALL, new AbortController().signal, FAST);
    expect(third.ok).toBe(true);
    if (third.ok) await third.body.cancel();
  });

  it("refuses an id that is not a call id or not started here, without opening a socket", async () => {
    await begin();
    expect(await openLiveTranscript("../etc", new AbortController().signal)).toEqual({ ok: false, code: "bad_call_id" });
    expect(await openLiveTranscript("call_other", new AbortController().signal)).toEqual({ ok: false, code: "not_found" });
    expect(monitor!.connections).toHaveLength(0);
  });

  it("refuses when no key is stored, and frees the claim", async () => {
    await begin();
    await removeKey();
    expect(await openLiveTranscript(CALL, new AbortController().signal, FAST)).toEqual({ ok: false, code: "not_connected" });
    await writeKey(KEY);
    const ok = await openLiveTranscript(CALL, new AbortController().signal, FAST);
    expect(ok.ok).toBe(true);
    if (ok.ok) await ok.body.cancel();
  });
});

describe("the key", () => {
  it("is in no line of the stream, no error and no log, even when Retell echoes it", async () => {
    await begin((conn) => {
      conn.send(snapshot(agent("u1", "agent", `Your key is ${KEY}`, 1), agent("u2", "user", "Fine words", 2)));
      conn.close(4001);
    });
    const stream = await open();
    const events = await stream.all();
    expect(events.map((e) => e.name)).toEqual(["utterance", "problem"]);
    const everything = JSON.stringify([stream.raw, events, logs]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("bearer");
    expect(everything).not.toContain("monitor-call");
    expect(everything).not.toContain("127.0.0.1");
  });

  it("is in no log or error when the socket cannot be opened", async () => {
    await begin();
    await monitor!.stop();
    const stream = await open();
    const events = await stream.all();
    expect(JSON.stringify([stream.raw, events, logs])).not.toContain(KEY);
  });
});
