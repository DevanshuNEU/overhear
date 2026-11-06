// A pull: list the last N calls, fetch each one (five at a time), analyze it, and keep the outcome by call id.
// The store lives on `globalThis`, so it survives dev hot reloads. The key is read from the key store inside the
// pull and held only in a closure: it is never in the store, in a progress answer or in an error.
// The analyzer is a parameter, so this file does not depend on the engine.
import { randomUUID } from "node:crypto";
import type { Outcome } from "@/engine/types";
import type { Verdict } from "@/report/schema";
import { POOL_SIZE, runPool, type PoolError } from "./pool";
import { logSafe } from "./redact";
import { getCall, listCalls, readStoredKey, type CallMeta, type RetellOptions } from "./retell-source";

export type PullId = string;
export type Analyze = (raw: unknown) => Outcome;

export type PullRow = {
  callId: string;
  startedAt: number;
  durationMs: number | null;
  state: "pending" | "report" | "no_content" | "error";
  verdict?: Verdict;
  headline?: string;
};

export type PullErrorCode = "bad_key" | "rate_limited" | "network" | "retell_down";

export type PullProgress = {
  id: PullId;
  phase: "listing" | "fetching" | "done" | "cancelled" | "failed";
  requested: number;
  listed: number | null;
  skipped: number;
  done: number;
  failed: number;
  waitingUntil: number | null;
  rows: PullRow[];
  error?: { code: PullErrorCode; message: string };
};

export const PULL_ERROR_MESSAGE: Record<PullErrorCode, string> = {
  bad_key: "Retell did not accept the stored key.",
  rate_limited: "Retell is limiting requests. Try again in a minute.",
  network: "Could not reach Retell.",
  retell_down: "Retell is having trouble right now.",
};

export type PullTuning = RetellOptions & {
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  now?: () => number;
};

type Entry = { meta: CallMeta; outcome: Outcome | null; analyze: Analyze };
type PullState = { progress: PullProgress; cancelled: boolean; settled: Promise<void> };
type Store = { pulls: Map<PullId, PullState>; calls: Map<string, Entry> };

const g = globalThis as typeof globalThis & { __overhearPulls?: Store };
const store: Store = (g.__overhearPulls ??= { pulls: new Map(), calls: new Map() });

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultJitter = () => Math.floor(Math.random() * 250);

function errorCode(code: string): PullErrorCode {
  return code === "bad_key" || code === "rate_limited" || code === "retell_down" ? code : "network";
}

function rowFor(meta: CallMeta, outcome: Outcome | null): PullRow {
  const base = { callId: meta.callId, startedAt: meta.startedAt, durationMs: meta.durationMs };
  if (outcome === null) return { ...base, state: "pending" };
  if (outcome.kind === "report") return { ...base, state: "report", verdict: outcome.report.verdict, headline: outcome.report.headline };
  return { ...base, state: outcome.kind };
}

function safeAnalyze(analyze: Analyze, raw: unknown, callId: string): Outcome {
  try {
    return analyze(raw);
  } catch {
    // The thrown message could quote the record. Say only that it failed.
    return { kind: "error", callId, message: "Could not check this call." };
  }
}

/** Starts a pull of the last n calls and returns its id at once. Poll getProgress(id). */
export function startPull(opts: { n: number; analyze: Analyze; key?: string } & PullTuning): PullId {
  const id: PullId = randomUUID();
  const progress: PullProgress = { id, phase: "listing", requested: opts.n, listed: null, skipped: 0, done: 0, failed: 0, waitingUntil: null, rows: [] };
  const state: PullState = { progress, cancelled: false, settled: Promise.resolve() };
  state.settled = run(state, opts).catch((err) => {
    logSafe("pull.crashed", { name: err instanceof Error ? "Error" : "unknown" });
    progress.phase = "failed";
    progress.error = { code: "network", message: PULL_ERROR_MESSAGE.network };
  });
  store.pulls.set(id, state);
  return id;
}

async function run(state: PullState, opts: { n: number; analyze: Analyze; key?: string } & PullTuning) {
  const { progress } = state;
  const key = opts.key ?? (await readStoredKey());
  const pool = {
    size: POOL_SIZE,
    sleep: opts.sleep ?? defaultSleep,
    jitter: opts.jitter ?? defaultJitter,
    now: opts.now,
    onWait: (until: number | null) => {
      progress.waitingUntil = until;
    },
  };
  const fail = (code: string) => {
    progress.phase = "failed";
    const c = errorCode(code);
    progress.error = { code: c, message: PULL_ERROR_MESSAGE[c] };
  };
  if (key === null) return fail("bad_key");

  const listing = (await runPool([() => listCalls(key, opts.n, opts)], { ...pool, size: 1, shouldStop: () => state.cancelled }))[0];
  if (!listing.ok) {
    if (listing.error.code === "cancelled") progress.phase = "cancelled";
    else fail(listing.error.code);
    return;
  }
  const { calls, listed, skipped } = listing.value;
  progress.listed = listed;
  progress.skipped = skipped;
  for (const meta of calls) {
    store.calls.set(meta.callId, { meta, outcome: null, analyze: opts.analyze });
    progress.rows.push(rowFor(meta, null));
  }
  progress.phase = "fetching";

  const settle = (index: number, outcome: Outcome | null) => {
    const meta = calls[index];
    const entry = store.calls.get(meta.callId);
    if (entry) entry.outcome = outcome;
    progress.rows[index] = rowFor(meta, outcome);
    if (outcome === null || outcome.kind === "error") progress.failed++;
    else progress.done++;
  };
  let keyLost = false;
  const tasks = calls.map((meta) => async () => safeAnalyze(opts.analyze, await getCall(key, meta.callId, opts), meta.callId));
  await runPool(tasks, {
    ...pool,
    shouldStop: () => state.cancelled,
    onResult: (i, r) => {
      if (r.ok) return settle(i, r.value as Outcome);
      if (r.error.code === "cancelled") return;
      if (r.error.code === "bad_key") {
        // The key stopped working mid-pull. The pull ends as failed below; finished outcomes stay.
        keyLost = true;
        progress.failed++;
        progress.rows[i] = { ...rowFor(calls[i], null), state: "error" };
        return;
      }
      settle(i, { kind: "error", callId: calls[i].callId, message: "Could not fetch this call from Retell." });
    },
  });
  progress.waitingUntil = null;
  if (state.cancelled) progress.phase = "cancelled";
  else if (keyLost) fail("bad_key");
  else progress.phase = "done";
}

export function getProgress(id: PullId): PullProgress | null {
  const state = store.pulls.get(id);
  return state ? structuredClone(state.progress) : null;
}

/** Resolves when the pull has stopped, however it stopped. For tests. */
export function whenSettled(id: PullId): Promise<void> {
  return store.pulls.get(id)?.settled ?? Promise.resolve();
}

export function getOutcome(callId: string): { meta: CallMeta; outcome: Outcome | { kind: "pending" } } | null {
  const entry = store.calls.get(callId);
  if (!entry) return null;
  return { meta: { ...entry.meta }, outcome: entry.outcome ?? { kind: "pending" } };
}

/** Stops new requests. Outcomes already stored stay. */
export function cancelPull(id: PullId): boolean {
  const state = store.pulls.get(id);
  if (!state) return false;
  if (state.progress.phase === "listing" || state.progress.phase === "fetching") state.cancelled = true;
  return true;
}

/** Fetches one call again, analyzes it and replaces its stored outcome. Null when the call is not in the store. */
export async function retryCall(callId: string, opts: { key?: string } & PullTuning = {}): Promise<Outcome | null> {
  const entry = store.calls.get(callId);
  if (!entry) return null;
  const key = opts.key ?? (await readStoredKey());
  const failed = (message: string): Outcome => ({ kind: "error", callId, message });
  if (key === null) return (entry.outcome = failed(PULL_ERROR_MESSAGE.bad_key));
  const [res] = await runPool([async () => safeAnalyze(entry.analyze, await getCall(key, callId, opts), callId)], {
    size: 1,
    sleep: opts.sleep ?? defaultSleep,
    jitter: opts.jitter ?? defaultJitter,
    now: opts.now,
    onWait: () => {},
  });
  const outcome = res.ok ? res.value : failed(PULL_ERROR_MESSAGE[errorCode((res.error as PoolError).code)]);
  entry.outcome = outcome;
  return outcome;
}
