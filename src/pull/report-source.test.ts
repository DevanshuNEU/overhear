// @vitest-environment node
// pullSource: the engine's reports behind getReport. A fake Retell serves the three samples written back as Retell
// records (toRetell) under unique call ids; the real pull, the real engine and the real getReport run on top of it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeRetellCall } from "@/engine/analyze";
import type { Outcome } from "@/engine/types";
import { m1View } from "@/engine/testing/build";
import { toRetell } from "@/engine/testing/retell";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import type { CallReport } from "@/report/schema";
import { getReport } from "@/report/store";
import { analyzeCall } from "./analyzer";
import { removeKey, writeKey } from "./key-store";
import { clearPulls, getOutcome, MAX_OPEN_FETCHES, MAX_OPENED, startPull, whenSettled } from "./pull";
import { makePullSource, pullSource } from "./report-source";

const KEY = "key_REPORTSRC0123456789abcdef";
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

let n = 0;
const uid = (label: string) => `call_${label}_${++n}_${Math.random().toString(36).slice(2, 8)}`;
const recordFor = (sample: CallReport, callId: string) => ({ ...(toRetell(sample.evidence) as Record<string, unknown>), call_id: callId });
const expected = (sample: CallReport, callId: string): CallReport => {
  const out = analyzeRetellCall(recordFor(sample, callId), { tz: zone() });
  if (out.kind !== "report") throw new Error("expected a report");
  return out.report;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake Retell on the global fetch: a list of the known records, and one get-call per id. */
function fakeRetell(records: Record<string, unknown>) {
  const seen: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (url.pathname === "/v3/list-calls") {
      const items = Object.values(records).map((r) => {
        const rec = r as Record<string, unknown>;
        return { call_id: rec.call_id, call_status: rec.call_status ?? "ended", start_timestamp: 1000, duration_ms: 5000 };
      });
      return json(200, { items, has_more: false });
    }
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    return id in records ? json(200, records[id]) : json(404, { message: "not found" });
  });
  vi.stubGlobal("fetch", fn);
  return { seen, gets: () => seen.filter((p) => !p.includes("list-calls")), fn };
}

let home: string;
beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-rs-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  await writeKey(KEY);
});
afterEach(() => {
  clearPulls();
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

const noSleep = { sleep: async () => {}, jitter: () => 0 };

async function pullAll(records: Record<string, unknown>, analyze: (raw: unknown) => Outcome = analyzeCall) {
  const id = startPull({ n: Object.keys(records).length, analyze, ...noSleep });
  await whenSettled(id);
}

describe("pullSource", () => {
  it("a finished pull's report comes back found, and equals the golden for the failed and passed calls", async () => {
    const failedId = uid("failed");
    const passedId = uid("passed");
    const records = { [failedId]: recordFor(failedSample, failedId), [passedId]: recordFor(passedSample, passedId) };
    const retell = fakeRetell(records);
    await pullAll(records);
    const before = retell.gets().length;

    const failed = await getReport(failedId, pullSource);
    const passed = await getReport(passedId, pullSource);
    expect(failed).toEqual({ status: "found", report: expected(failedSample, failedId) });
    expect(passed).toEqual({ status: "found", report: expected(passedSample, passedId) });
    // The golden (M1's view of the sample) is the report, apart from the id the fake Retell served the call under.
    const reId = (sample: CallReport, id: string) => {
      const golden = m1View(sample);
      return { ...golden, callId: id, evidence: { ...golden.evidence, callId: id } };
    };
    if (failed.status === "found") expect(failed.report).toEqual(reId(failedSample, failedId));
    if (passed.status === "found") expect(passed.report).toEqual(reId(passedSample, passedId));
    // Served from the store: no request at all.
    expect(retell.gets()).toHaveLength(before);
  });

  it("a call not in the store is fetched once, analyzed and stored", async () => {
    const id = uid("fresh");
    const retell = fakeRetell({ [id]: recordFor(failedSample, id) });
    const [a, b] = await Promise.all([getReport(id, pullSource), getReport(id, pullSource)]);
    expect(a).toEqual({ status: "found", report: expected(failedSample, id) });
    expect(b).toEqual(a);
    expect(retell.gets()).toHaveLength(1);
    // Stored: the next open makes no request, and the pull store has the outcome.
    expect(await getReport(id, pullSource)).toEqual(a);
    expect(retell.gets()).toHaveLength(1);
    expect(getOutcome(id)?.outcome.kind).toBe("report");
  });

  it("no_content and error outcomes give not_found", async () => {
    const quiet = uid("quiet");
    const broken = uid("broken");
    const records = { [quiet]: { call_id: quiet, call_status: "ended", start_timestamp: 1000, transcript_object: [] }, [broken]: recordFor(failedSample, broken) };
    fakeRetell(records);
    await pullAll(records, (raw) => {
      const id = (raw as { call_id: string }).call_id;
      return id === broken ? { kind: "error", callId: id, message: "Could not check this call." } : analyzeCall(raw);
    });
    expect(getOutcome(quiet)?.outcome.kind).toBe("no_content");
    expect(getOutcome(broken)?.outcome.kind).toBe("error");
    expect(await getReport(quiet, pullSource)).toEqual({ status: "not_found", callId: quiet });
    expect(await getReport(broken, pullSource)).toEqual({ status: "not_found", callId: broken });
  });

  it("a single fetch that gives no_content is not found, and one that gives an error is not stored, so the next open tries again", async () => {
    const quiet = uid("quiet");
    const retell = fakeRetell({ [quiet]: { call_id: quiet, call_status: "ended", start_timestamp: 1000, transcript_object: [] } });
    expect(await getReport(quiet, pullSource)).toEqual({ status: "not_found", callId: quiet });
    expect(getOutcome(quiet)?.outcome.kind).toBe("no_content");

    const err = uid("err");
    const failing = makePullSource({ analyze: () => ({ kind: "error", callId: err, message: "Could not check this call." }) });
    const retell2 = fakeRetell({ [err]: recordFor(failedSample, err) });
    expect(await getReport(err, failing)).toEqual({ status: "not_found", callId: err });
    expect(await getReport(err, failing)).toEqual({ status: "not_found", callId: err });
    expect(getOutcome(err)).toBeNull();
    expect(retell2.gets()).toHaveLength(2);
    expect(retell.gets()).toHaveLength(1);
  });

  it("a call that has not ended is not found and not stored", async () => {
    const id = uid("live");
    fakeRetell({ [id]: { ...recordFor(failedSample, id), call_status: "ongoing" } });
    expect(await getReport(id, pullSource)).toEqual({ status: "not_found", callId: id });
    expect(getOutcome(id)).toBeNull();
  });

  it("no key gives not_found and makes no request", async () => {
    const id = uid("nokey");
    await removeKey();
    const retell = fakeRetell({ [id]: recordFor(failedSample, id) });
    expect(await getReport(id, pullSource)).toEqual({ status: "not_found", callId: id });
    expect(retell.seen).toEqual([]);
  });

  it("an unsafe key file gives not_found and never throws", async () => {
    const id = uid("unsafe");
    fs.chmodSync(path.join(home, "config.json"), 0o644);
    const retell = fakeRetell({ [id]: recordFor(failedSample, id) });
    expect(await getReport(id, pullSource)).toEqual({ status: "not_found", callId: id });
    expect(retell.seen).toEqual([]);
  });

  it("Retell 404 gives not_found", async () => {
    const id = uid("gone");
    const retell = fakeRetell({});
    expect(await getReport(id, pullSource)).toEqual({ status: "not_found", callId: id });
    expect(retell.gets()).toHaveLength(1);
    expect(getOutcome(id)).toBeNull();
    // Remembered until Disconnect: opening a made-up id again does not ask Retell again.
    expect(await getReport(id, pullSource)).toEqual({ status: "not_found", callId: id });
    expect(await getReport(id, pullSource)).toEqual({ status: "not_found", callId: id });
    expect(retell.gets()).toHaveLength(1);
    clearPulls();
    expect(await getReport(id, pullSource)).toEqual({ status: "not_found", callId: id });
    expect(retell.gets()).toHaveLength(2);
  });

  it("an id that cannot be a Retell call id never reaches Retell", async () => {
    const retell = fakeRetell({});
    for (const bad of ["", "../x", "a/b", "a b", "x".repeat(200), "call?x=1"]) {
      expect(await getReport(bad, pullSource)).toEqual({ status: "not_found", callId: bad });
    }
    expect(retell.seen).toEqual([]);
  });

  it("after Disconnect every id gives not_found and makes no request", async () => {
    const id = uid("before");
    const other = uid("other");
    const retell = fakeRetell({ [id]: recordFor(failedSample, id), [other]: recordFor(passedSample, other) });
    expect((await getReport(id, pullSource)).status).toBe("found");
    clearPulls();
    await removeKey();
    const seen = retell.seen.length;
    expect(await getReport(id, pullSource)).toEqual({ status: "not_found", callId: id });
    expect(await getReport(other, pullSource)).toEqual({ status: "not_found", callId: other });
    expect(retell.seen).toHaveLength(seen);
  });

  it("a fetch still in flight when Disconnect happens stores nothing", async () => {
    const id = uid("race");
    fakeRetell({ [id]: recordFor(failedSample, id) });
    const pending = getReport(id, pullSource);
    clearPulls();
    await pending;
    expect(getOutcome(id)).toBeNull();
  });

  /** A fake Retell whose get-calls wait until released, so a test can hold requests in flight and in the queue. */
  function gatedRetell(ids: string[]) {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const id = decodeURIComponent(new URL(String(input)).pathname.split("/").pop()!);
        started.push(id);
        await gate;
        return ids.includes(id) ? json(200, recordFor(failedSample, id)) : json(404, {});
      }),
    );
    return { started, release };
  }
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setImmediate(r));
    expect(done()).toBe(true);
  };

  it("a fetch still queued at Disconnect sends nothing, with the old key or any other", async () => {
    const ids = Array.from({ length: 7 }, () => uid("queued"));
    const retell = gatedRetell(ids);
    const opens = ids.map((i) => getReport(i, pullSource));
    await until(() => retell.started.length === 5);
    clearPulls();
    await removeKey();
    retell.release();
    const results = await Promise.all(opens);
    // Five were already on the wire; the two that were waiting for a slot never went out.
    expect(retell.started).toHaveLength(5);
    expect(results.filter((r) => r.status === "not_found")).toHaveLength(7);
    for (const i of ids) expect(getOutcome(i)).toBeNull();
  });

  it("an eighth concurrent address fetch (five in flight, two waiting) makes no request", async () => {
    const ids = Array.from({ length: MAX_OPEN_FETCHES + 1 }, () => uid("flood"));
    const retell = gatedRetell(ids);
    const opens = ids.map((i) => getReport(i, pullSource));
    await until(() => retell.started.length === 5);
    retell.release();
    const results = await Promise.all(opens);
    expect(retell.started).toHaveLength(MAX_OPEN_FETCHES);
    expect(results.slice(0, MAX_OPEN_FETCHES).every((r) => r.status === "found")).toBe(true);
    expect(results[MAX_OPEN_FETCHES]).toEqual({ status: "not_found", callId: ids[MAX_OPEN_FETCHES] });
    expect(retell.started).not.toContain(ids[MAX_OPEN_FETCHES]);
  });

  it("a report the schema rejects gives unreadable", async () => {
    const id = uid("bad");
    fakeRetell({ [id]: recordFor(failedSample, id) });
    const source = makePullSource({ analyze: () => ({ kind: "report", report: { ...failedSample, callId: id, verdict: "passed" } }) });
    const found = await getReport(id, source);
    expect(found.status).toBe("unreadable");
    expect(found).not.toHaveProperty("report");
  });

  it("keeps at most MAX_OPENED calls opened by address and drops the oldest", async () => {
    const ids = Array.from({ length: MAX_OPENED + 3 }, () => uid("cap"));
    fakeRetell(Object.fromEntries(ids.map((i) => [i, recordFor(passedSample, i)])));
    for (const id of ids) await getReport(id, pullSource);
    expect(getOutcome(ids[0])).toBeNull();
    expect(getOutcome(ids[2])).toBeNull();
    expect(getOutcome(ids[3])?.outcome.kind).toBe("report");
    expect(getOutcome(ids[ids.length - 1])?.outcome.kind).toBe("report");
  });

  it("goes through the shared limiter: never more than five requests in flight", async () => {
    let live = 0;
    let peak = 0;
    const ids = Array.from({ length: 12 }, () => uid("lim"));
    const records = Object.fromEntries(ids.map((i) => [i, recordFor(failedSample, i)]));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setImmediate(r));
        live--;
        const id = decodeURIComponent(new URL(String(input)).pathname.split("/").pop()!);
        return json(200, records[id]);
      }),
    );
    await Promise.all(ids.map((i) => getReport(i, pullSource)));
    expect(peak).toBeLessThanOrEqual(5);
  });
});

describe("defaultSource through getReport", () => {
  it("the real pull, then each sample opens from the store and equals what analyzeRetellCall gives", async () => {
    const samples = [failedSample, needsReviewSample, passedSample];
    const ids = samples.map((s) => uid(s.callId));
    const records = Object.fromEntries(samples.map((s, i) => [ids[i], recordFor(s, ids[i])]));
    const retell = fakeRetell(records);
    await pullAll(records);
    const before = retell.gets().length;
    for (const [i, sample] of samples.entries()) {
      expect(await getReport(ids[i])).toEqual({ status: "found", report: expected(sample, ids[i]) });
    }
    expect(retell.gets()).toHaveLength(before);
  });

  it("an id the pull never listed is fetched on open in local mode", async () => {
    const id = uid("direct");
    const retell = fakeRetell({ [id]: recordFor(passedSample, id) });
    expect(await getReport(id)).toEqual({ status: "found", report: expected(passedSample, id) });
    expect(retell.gets()).toHaveLength(1);
  });

  it("the samples and demo states win over the pull store and never touch Retell", async () => {
    const retell = fakeRetell({});
    for (const sample of [failedSample, needsReviewSample, passedSample]) {
      expect(await getReport(sample.callId)).toEqual({ status: "found", report: sample });
    }
    vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect((await getReport("call_demo_slow")).status).toBe("found");
    expect(retell.seen).toEqual([]);
  });

  it("an id that is not a sample or a demo state is fetched after them, in local mode", async () => {
    vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
    vi.stubEnv("NODE_ENV", "development");
    const id = uid("after");
    const retell = fakeRetell({ [id]: recordFor(failedSample, id) });
    expect((await getReport(id)).status).toBe("found");
    expect(retell.gets()).toHaveLength(1);
  });

  it("hosted copy: an id that is not a sample is not found and Retell is never called", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    const id = uid("hosted");
    const retell = fakeRetell({ [id]: recordFor(failedSample, id) });
    expect(await getReport(id)).toEqual({ status: "not_found", callId: id });
    expect(await getReport("call_nope")).toEqual({ status: "not_found", callId: "call_nope" });
    expect((await getReport(failedSample.callId)).status).toBe("found");
    expect(retell.seen).toEqual([]);
  });

  it("hosted copy in production with the demo flag set is still not found and never calls Retell", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
    vi.stubEnv("NODE_ENV", "production");
    const retell = fakeRetell({});
    expect((await getReport("call_x")).status).toBe("not_found");
    expect(retell.seen).toEqual([]);
  });
});
