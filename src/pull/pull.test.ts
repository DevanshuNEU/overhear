// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Outcome } from "@/engine/types";
import { SAMPLE_REPORTS } from "@/report/samples";
import { cancelPull, getOutcome, getProgress, retryCall, startPull, whenSettled } from "./pull";

const KEY = "key_PULLTEST0123456789abcdef";
const TOKEN = "web_access_token_SECRET";

type Script = { list?: () => Response; get?: (id: string) => Response };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const item = (id: string, status = "ended") => ({ call_id: id, call_status: status, start_timestamp: 1000, duration_ms: 5000, agent_id: "agent_1", access_token: TOKEN });

function fake(ids: string[], script: Script = {}, statuses: Record<string, string> = {}) {
  const seen: string[] = [];
  let live = 0;
  let peak = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setImmediate(r));
    live--;
    if (url.pathname === "/v3/list-calls") return script.list?.() ?? json(200, { items: ids.map((i) => item(i, statuses[i])), has_more: false });
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    return script.get?.(id) ?? json(200, { call_id: id, transcript: "hello" });
  }) as typeof fetch;
  return { fn, seen, peak: () => peak };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `call_${i}`);
const reportFor = (callId: string): Outcome => ({ kind: "report", report: { ...SAMPLE_REPORTS[0], callId } });
const analyze = (raw: unknown): Outcome => reportFor((raw as { call_id: string }).call_id);

const sleeps: number[] = [];
const tune = (f: ReturnType<typeof fake>) => ({
  key: KEY,
  fetch: f.fn,
  baseURL: "http://stub.test",
  sleep: async (ms: number) => {
    sleeps.push(ms);
  },
  jitter: () => 0,
});

beforeEach(() => {
  sleeps.length = 0;
});
afterEach(() => {
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});

async function pull(f: ReturnType<typeof fake>, n: number, an = analyze) {
  const id = startPull({ n, analyze: an, ...tune(f) });
  await whenSettled(id);
  return { id, p: getProgress(id)! };
}

describe("startPull", () => {
  it("makes one list request and N get-calls for N calls", async () => {
    const f = fake(ids(7));
    const { p } = await pull(f, 7);
    expect(f.seen.filter((s) => s.includes("list-calls"))).toHaveLength(1);
    expect(f.seen).toHaveLength(8);
    expect(p.phase).toBe("done");
    expect(p.done).toBe(7);
  });

  it("never has more than five get-calls in flight", async () => {
    const f = fake(ids(20));
    await pull(f, 20);
    expect(f.peak()).toBeLessThanOrEqual(5);
  });

  it("a 429 pauses every worker and honours Retry-After", async () => {
    let first = true;
    const f = fake(ids(3), { get: (id) => (id === "call_0" && first ? ((first = false), json(429, {}, { "retry-after": "2" })) : json(200, { call_id: id })) });
    const { p } = await pull(f, 3);
    expect(sleeps).toEqual([2000]);
    expect(p.done).toBe(3);
    expect(p.waitingUntil).toBeNull();
  });

  it("without Retry-After the waits are 1, 2, 4, 8 seconds, then that call is an error", async () => {
    const f = fake(ids(2), { get: (id) => (id === "call_0" ? json(429, {}) : json(200, { call_id: id })) });
    const { p, id } = await pull(f, 2);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect(p.failed).toBe(1);
    expect(p.done).toBe(1);
    expect(getOutcome("call_0")?.outcome).toMatchObject({ kind: "error" });
    expect(id).toBeTruthy();
  });

  it("one failed call leaves the others and counts in failed", async () => {
    const f = fake(ids(4), { get: (id) => (id === "call_1" ? json(404, {}) : json(200, { call_id: id })) });
    const { p } = await pull(f, 4);
    expect(p.phase).toBe("done");
    expect(p.failed).toBe(1);
    expect(p.done).toBe(3);
    expect(p.rows.map((r) => r.state)).toEqual(["report", "error", "report", "report"]);
  });

  it("a 401 on the list request fails the pull with bad_key", async () => {
    const f = fake(ids(3), { list: () => json(401, {}) });
    const { p } = await pull(f, 3);
    expect(p.phase).toBe("failed");
    expect(p.error?.code).toBe("bad_key");
    expect(f.seen).toHaveLength(1);
  });

  it("a 401 on a get-call aborts the pull with bad_key", async () => {
    const f = fake(ids(10), { get: () => json(401, {}) });
    const { p } = await pull(f, 10);
    expect(p.phase).toBe("failed");
    expect(p.error?.code).toBe("bad_key");
    expect(f.seen.length).toBeLessThan(11);
  });

  it("cancel stops new requests and keeps finished outcomes", async () => {
    const f = fake(ids(30));
    const id = startPull({ n: 30, analyze, ...tune(f) });
    for (let i = 0; i < 200 && getOutcome("call_0")?.outcome.kind !== "report"; i++) await new Promise((r) => setImmediate(r));
    cancelPull(id);
    await whenSettled(id);
    const p = getProgress(id)!;
    expect(p.phase).toBe("cancelled");
    expect(f.seen.length).toBeLessThan(31);
    expect(getOutcome("call_0")?.outcome.kind).toBe("report");
  });

  it("listed is the number Retell returned, and done never exceeds listed", async () => {
    const f = fake(ids(3));
    const { p } = await pull(f, 10);
    expect(p.requested).toBe(10);
    expect(p.listed).toBe(3);
    expect(p.done + p.failed + p.skipped).toBeLessThanOrEqual(p.listed!);
  });

  it("skips calls that have not ended", async () => {
    const f = fake(ids(4), {}, { call_1: "ongoing", call_2: "registered" });
    const { p } = await pull(f, 4);
    expect(p.listed).toBe(4);
    expect(p.skipped).toBe(2);
    expect(p.rows.map((r) => r.callId)).toEqual(["call_0", "call_3"]);
    expect(f.seen).toHaveLength(3);
  });

  it("outcomes appear in the store as each call finishes", async () => {
    const f = fake(ids(2));
    const id = startPull({ n: 2, analyze, ...tune(f) });
    expect(getProgress(id)?.phase).toBe("listing");
    await whenSettled(id);
    expect(getOutcome("call_0")?.outcome.kind).toBe("report");
    expect(getOutcome("nope")).toBeNull();
  });

  it("the analyzer throwing becomes an error outcome for that call only", async () => {
    const f = fake(ids(3));
    const { p } = await pull(f, 3, (raw) => {
      if ((raw as { call_id: string }).call_id === "call_1") throw new Error(`boom ${KEY}`);
      return analyze(raw);
    });
    expect(p.failed).toBe(1);
    expect(p.done).toBe(2);
    expect(JSON.stringify(getOutcome("call_1"))).not.toContain(KEY);
  });

  it("a web call's access_token and the key never appear in the store or a response", async () => {
    const f = fake(ids(3));
    const { id, p } = await pull(f, 3);
    const all = JSON.stringify([p, getProgress(id), ids(3).map(getOutcome)]);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(KEY);
  });

  it("retryCall refetches one call and replaces its error outcome", async () => {
    let broken = true;
    const f = fake(ids(2), { get: (id) => (id === "call_0" && broken ? json(404, {}) : json(200, { call_id: id })) });
    await pull(f, 2);
    expect(getOutcome("call_0")?.outcome.kind).toBe("error");
    broken = false;
    const before = f.seen.length;
    const out = await retryCall("call_0", tune(f));
    expect(out?.kind).toBe("report");
    expect(f.seen.length).toBe(before + 1);
    expect(getOutcome("call_0")?.outcome.kind).toBe("report");
    expect(await retryCall("unknown", tune(f))).toBeNull();
  });
});
