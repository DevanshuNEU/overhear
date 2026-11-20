// Where a call made on the public demo stands, and what the engine made of it. Hosted only, in memory only: nothing is
// written to disk or the database, and a restart forgets every call.
//
// One ask is one get-call request on the server's own Retell key, and never more than one per call every 2 seconds: the last
// answer is kept for that long, and asks that arrive together share one request. A call whose agent is not the demo agent is
// answered as not found, so this route cannot be used to read any other call on the account. Once a call has ended and Retell
// has its transcript, the engine's outcome is kept (50 calls, an hour) for the call list's row and the report page.
//
// The wait follows the local test call (src/pull/test-call.ts): processing until the transcript is there, an empty transcript
// is read as it is after EMPTY_TRANSCRIPT_GRACE_MS, and a call that never fills in times out RESULT_TIMEOUT_MS after it ended.
import { analyzeRetellCall } from "@/engine/analyze";
import type { Outcome } from "@/engine/types";
import { env } from "@/lib/env";
import { rowFor, type PullRow } from "@/pull/pull";
import { EMPTY_TRANSCRIPT_GRACE_MS, RESULT_TIMEOUT_MS } from "@/pull/test-call";
import { getCall, RETELL_ID, toMeta } from "@/pull/retell-source";
import { CallReportSchema, type CallReport } from "@/report/schema";
import type { DemoCallErrorCode } from "./words";

/** The least time between two Retell requests for one call. */
export const MIN_ASK_MS = 2000;
/** How many outcomes are kept, and for how long. */
export const MAX_READY = 50;
export const READY_TTL_MS = 60 * 60 * 1000;
/** How many calls' last answers and end times are remembered, so a stream of ids cannot grow the maps. */
const MAX_TRACKED = 200;

export type DemoResult =
  | { status: "processing" }
  | { status: "did_not_connect" }
  | { status: "timeout" }
  | { status: "ready"; row: PullRow };
export type DemoAnswer = { ok: true; result: DemoResult } | { ok: false; code: DemoCallErrorCode };

type Ready = { row: PullRow; report: CallReport | null; at: number };
type Last = { at: number; answer: DemoAnswer };
type State = { ready: Map<string, Ready>; last: Map<string, Last>; endedAt: Map<string, number>; inflight: Map<string, Promise<DemoAnswer>> };

const g = globalThis as typeof globalThis & { __overhearDemoCalls?: State };
const state = (): State => (g.__overhearDemoCalls ??= { ready: new Map(), last: new Map(), endedAt: new Map(), inflight: new Map() });

/** Forgets every call. For tests. */
export function resetDemoCalls(): void {
  g.__overhearDemoCalls = undefined;
}

export type Deps = { now?: () => number; getCall?: (key: string, id: string) => Promise<unknown> };

/** Where Retell may put a call's transcript, in the engine adapter's reading order (src/engine/adapters/retell.ts). */
const TRANSCRIPT_SOURCES = ["transcript_with_tool_calls", "scrubbed_transcript_with_tool_calls", "transcript_object"] as const;

const isRec =(v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (code: DemoCallErrorCode): DemoAnswer => ({ ok: false, code });

function trim<V>(map: Map<string, V>, max: number): void {
  for (const id of [...map.keys()].slice(0, Math.max(0, map.size - max))) map.delete(id);
}

function liveReady(id: string, now: number): Ready | undefined {
  const s = state();
  const hit = s.ready.get(id);
  if (hit && now - hit.at > READY_TTL_MS) {
    s.ready.delete(id);
    return undefined;
  }
  return hit;
}

/** The report of a call this server checked, while it is kept. */
export function cachedDemoReport(callId: string, now: number = Date.now()): CallReport | undefined {
  return liveReady(callId, now)?.report ?? undefined;
}

/** True when the engine's outcome, as JSON, holds the key: the call's own words never should. */
const holdsKey = (value: unknown, key: string): boolean => JSON.stringify(value).includes(key);

function analyze(raw: unknown, agentId: string): Outcome {
  try {
    // UTC, as on the sample list: the demo agent's own policy names the zone for spoken times.
    return analyzeRetellCall(raw, { tz: "UTC", demoAgentId: agentId });
  } catch {
    return { kind: "error", callId: null, message: "Could not check this call." };
  }
}

/**
 * Where a demo call stands. Only for an id that passed the cookie check. Never throws: every way it can stop is a code.
 * `processing` while the call has not ended or Retell has no transcript yet; `ready` with the list row once it has.
 */
export function demoCallResult(callId: string, deps: Deps = {}): Promise<DemoAnswer> {
  if (!RETELL_ID.test(callId)) return Promise.resolve(fail("not_found"));
  const s = state();
  const now = (deps.now ?? Date.now)();
  const ready = liveReady(callId, now);
  if (ready) return Promise.resolve({ ok: true, result: { status: "ready", row: ready.row } });
  const last = s.last.get(callId);
  if (last && now - last.at < MIN_ASK_MS) return Promise.resolve(last.answer);
  const running = s.inflight.get(callId);
  if (running) return running;
  const run = ask(callId, deps, now).then((answer) => {
    s.last.set(callId, { at: (deps.now ?? Date.now)(), answer });
    trim(s.last, MAX_TRACKED);
    return answer;
  });
  const done = run.finally(() => {
    if (s.inflight.get(callId) === done) s.inflight.delete(callId);
  });
  s.inflight.set(callId, done);
  return done;
}

async function ask(callId: string, deps: Deps, now: number): Promise<DemoAnswer> {
  const s = state();
  try {
    const agentId = env.RETELL_AGENT_ID;
    const key = env.RETELL_API_KEY;
    if (!agentId) return fail("not_configured");
    let raw: unknown;
    try {
      raw = await (deps.getCall ?? getCall)(key, callId);
    } catch (err) {
      // A call Retell does not have is not found; any other trouble is said in our words, never Retell's.
      const status = isRec(err) && typeof err.status === "number" ? err.status : undefined;
      return fail(status === 404 ? "not_found" : "unavailable");
    }
    if (!isRec(raw) || raw.call_id !== callId) return fail("unreadable");
    // Only the demo agent's calls: the server key can read every call on the account, so this is the line that keeps them private.
    if (raw.agent_id !== agentId) return fail("not_found");

    const status = raw.call_status;
    if (status === "error" || status === "not_connected") return { ok: true, result: { status: "did_not_connect" } };
    if (status !== "ended") return { ok: true, result: { status: "processing" } };

    const endedAt = s.endedAt.get(callId) ?? now;
    s.endedAt.set(callId, endedAt);
    trim(s.endedAt, MAX_TRACKED);
    // The same sources, in the same order, as the engine's Retell adapter: the first one with turns is what it reads.
    const sources = TRANSCRIPT_SOURCES.map((key) => raw[key]);
    const hasTurns = sources.some((t) => Array.isArray(t) && t.length > 0);
    if (hasTurns || (sources.some(Array.isArray) && now - endedAt >= EMPTY_TRANSCRIPT_GRACE_MS)) {
      const meta = toMeta(raw);
      if (meta === null) return fail("unreadable");
      let outcome = analyze(raw, agentId);
      if (holdsKey(outcome, key)) outcome = { kind: "error", callId, message: "Could not check this call." };
      let report: CallReport | null = null;
      if (outcome.kind === "report") {
        const parsed = CallReportSchema.safeParse(outcome.report);
        if (parsed.success) report = parsed.data;
        else outcome = { kind: "error", callId, message: "Could not check this call." };
      }
      const row = rowFor(meta, report ? { kind: "report", report } : outcome);
      s.ready.set(callId, { row, report, at: now });
      trim(s.ready, MAX_READY);
      return { ok: true, result: { status: "ready", row } };
    }
    if (now - endedAt >= RESULT_TIMEOUT_MS) return { ok: true, result: { status: "timeout" } };
    return { ok: true, result: { status: "processing" } };
  } catch {
    return fail("failed");
  }
}
