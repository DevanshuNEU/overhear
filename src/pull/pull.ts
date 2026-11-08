// A pull: list the last N calls, fetch each one (five at a time), analyze it, and keep the outcome by call id.
// One pull runs at a time, and every Retell request (the pull's and a refetch's) goes through one shared limiter, so
// five in flight and one 429 pause hold across all of them. The store keeps the last 20 pulls.
// The store lives on `globalThis`, so it survives dev hot reloads. The key is read from the key store inside the
// pull and held only in a closure: it is never in the store, in a progress answer or in an error.
// The analyzer is a parameter, so this file does not depend on the engine.
import { randomUUID } from "node:crypto";
import type { Outcome } from "@/engine/types";
import { answerOf } from "@/components/report/answer";
import type { CallReport, Verdict } from "@/report/schema";
import { createLimiter, POOL_SIZE, runPool, type Limiter, type PoolError, type PoolResult } from "./pool";
import { PULL_ERROR_MESSAGE, type PullErrorCode } from "./labels";
import { logSafe } from "./redact";
import { getCall, listCalls, readStoredKey, toMeta, type CallMeta, type RetellOptions } from "./retell-source";

export { PULL_ERROR_MESSAGE, type PullErrorCode };
export type PullId = string;
export type Analyze = (raw: unknown) => Outcome;

export type PullRow = {
  callId: string;
  startedAt: number;
  durationMs: number | null;
  state: "pending" | "report" | "no_content" | "error";
  verdict?: Verdict;
  headline?: string;
  /** The sentence the call's report leads with (answerOf, the same one the call screen shows). Absent for a passed call. */
  lead?: string;
};

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

export type PullTuning = RetellOptions & {
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  now?: () => number;
};

/** How many pulls the store keeps. The oldest goes first, with the calls only it holds. */
export const MAX_PULLS = 20;

type Entry = { meta: CallMeta; outcome: Outcome | null; analyze: Analyze; pullId: PullId; index: number };
type PullState = { progress: PullProgress; cancelled: boolean; abort: AbortController; settled: Promise<void> };
type Store = {
  pulls: Map<PullId, PullState>;
  calls: Map<string, Entry>;
  limiter: Limiter;
  /** Single-call fetches under way, by call id, so two readers of one call make one request. */
  fetching: Map<string, Promise<Outcome | null>>;
  /** Calls Retell said it does not have, until Disconnect, so a made-up id opened again is not asked again. */
  missing: Set<string>;
  /** Counts clearPulls, so a fetch that began before Disconnect can tell and store nothing. */
  epoch: number;
};

const g = globalThis as typeof globalThis & { __overhearPulls?: Store };
// Read on every use, so a reset of the global (tests) takes effect.
const getStore = (): Store =>
  (g.__overhearPulls ??= { pulls: new Map(), calls: new Map(), limiter: createLimiter(POOL_SIZE), fetching: new Map(), missing: new Set(), epoch: 0 });

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultJitter = () => Math.floor(Math.random() * 250);

function errorCode(code: string): PullErrorCode {
  return code === "bad_key" || code === "rate_limited" || code === "retell_down" ? code : "network";
}

/** The report's lead sentence, from the one function the call screen uses. A report it cannot read a lead from has none. */
function leadOf(report: CallReport): string | undefined {
  try {
    return answerOf(report)?.text;
  } catch {
    return undefined;
  }
}

function rowFor(meta: CallMeta, outcome: Outcome | null): PullRow {
  const base = { callId: meta.callId, startedAt: meta.startedAt, durationMs: meta.durationMs };
  if (outcome === null) return { ...base, state: "pending" };
  if (outcome.kind === "report") {
    const lead = leadOf(outcome.report);
    return { ...base, state: "report", verdict: outcome.report.verdict, headline: outcome.report.headline, ...(lead ? { lead } : {}) };
  }
  return { ...base, state: outcome.kind };
}

const isActive = (state: PullState) => state.progress.phase === "listing" || state.progress.phase === "fetching";

/** The id of the pull that is listing or fetching, or null. */
export function activePullId(): PullId | null {
  for (const state of getStore().pulls.values()) if (isActive(state)) return state.progress.id;
  return null;
}

function evictOldPulls(store: Store) {
  for (const [id, state] of store.pulls) {
    if (store.pulls.size <= MAX_PULLS) return;
    if (isActive(state)) continue;
    store.pulls.delete(id);
    for (const [callId, entry] of store.calls) if (entry.pullId === id) store.calls.delete(callId);
  }
}

/** Puts a row in place and keeps the done and failed counts equal to what the rows say. */
function applyRow(progress: PullProgress, index: number, row: PullRow) {
  const prev = progress.rows[index]?.state;
  if (prev === "error") progress.failed--;
  else if (prev === "report" || prev === "no_content") progress.done--;
  progress.rows[index] = row;
  if (row.state === "error") progress.failed++;
  else if (row.state === "report" || row.state === "no_content") progress.done++;
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
  const state: PullState = { progress, cancelled: false, abort: new AbortController(), settled: Promise.resolve() };
  state.settled = run(state, opts).catch((err) => {
    logSafe("pull.crashed", { name: err instanceof Error ? "Error" : "unknown" });
    progress.phase = "failed";
    progress.error = { code: "network", message: PULL_ERROR_MESSAGE.network };
  });
  const store = getStore();
  store.pulls.set(id, state);
  evictOldPulls(store);
  return id;
}

async function run(state: PullState, opts: { n: number; analyze: Analyze; key?: string } & PullTuning) {
  const { progress } = state;
  const store = getStore();
  const key = opts.key ?? (await readStoredKey());
  const pool = {
    size: POOL_SIZE,
    limiter: store.limiter,
    signal: state.abort.signal,
    sleep: opts.sleep ?? defaultSleep,
    jitter: opts.jitter ?? defaultJitter,
    now: opts.now,
    onWait: (until: number | null) => {
      // A late 429 must not put a wait back on a pull that is already cancelled.
      if (state.cancelled) return;
      progress.waitingUntil = until;
    },
  };
  const fail = (code: string) => {
    if (state.cancelled) return;
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
  if (state.cancelled) return;
  calls.forEach((meta, index) => {
    store.calls.set(meta.callId, { meta, outcome: null, analyze: opts.analyze, pullId: progress.id, index });
    progress.rows.push(rowFor(meta, null));
  });
  progress.phase = "fetching";

  const settle = (index: number, outcome: Outcome | null) => {
    const meta = calls[index];
    // The call may belong to a newer pull by now (the same call listed again): then this pull must not write over it.
    const entry = store.calls.get(meta.callId);
    if (entry && entry.pullId !== progress.id) return;
    if (entry) entry.outcome = outcome;
    applyRow(progress, index, rowFor(meta, outcome));
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
        settle(i, { kind: "error", callId: calls[i].callId, message: PULL_ERROR_MESSAGE.bad_key });
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
  const state = getStore().pulls.get(id);
  return state ? structuredClone(state.progress) : null;
}

/** Resolves when the pull has stopped, however it stopped. For tests. */
export function whenSettled(id: PullId): Promise<void> {
  return getStore().pulls.get(id)?.settled ?? Promise.resolve();
}

export function getOutcome(callId: string): { meta: CallMeta; outcome: Outcome | { kind: "pending" } } | null {
  const entry = getStore().calls.get(callId);
  if (!entry) return null;
  return { meta: { ...entry.meta }, outcome: entry.outcome ?? { kind: "pending" } };
}

/**
 * Stops every pull that is running, then drops all pulls and the calls they kept (reports and the rows that point at
 * them). Used by Disconnect: the key and what it fetched leave memory together. A request already in flight finishes,
 * but nothing it returns is stored, because the call is no longer in the store.
 */
export function clearPulls(): void {
  const store = getStore();
  for (const id of [...store.pulls.keys()]) cancelPull(id);
  store.pulls.clear();
  store.calls.clear();
  store.fetching.clear();
  store.missing.clear();
  store.epoch++;
}

/** Stops new requests, shows the cancelled phase at once and wakes workers in a 429 pause. Outcomes already stored stay. */
export function cancelPull(id: PullId): boolean {
  const state = getStore().pulls.get(id);
  if (!state) return false;
  if (isActive(state)) {
    state.cancelled = true;
    state.progress.phase = "cancelled";
    state.progress.waitingUntil = null;
    state.abort.abort();
  }
  return true;
}

/** Fetches one call again, analyzes it and replaces its stored outcome and its row in the pull. Null when the call is not in the store. */
export async function retryCall(callId: string, opts: { key?: string } & PullTuning = {}): Promise<Outcome | null> {
  const store = getStore();
  const entry = store.calls.get(callId);
  if (!entry) return null;
  const key = opts.key ?? (await readStoredKey());
  const failed = (message: string): Outcome => ({ kind: "error", callId, message });
  let outcome: Outcome;
  if (key === null) {
    outcome = failed(PULL_ERROR_MESSAGE.bad_key);
  } else {
    const [res] = await runPool([async () => safeAnalyze(entry.analyze, await getCall(key, callId, opts), callId)], {
      size: 1,
      limiter: store.limiter,
      sleep: opts.sleep ?? defaultSleep,
      jitter: opts.jitter ?? defaultJitter,
      now: opts.now,
      onWait: () => {},
    });
    outcome = res.ok ? res.value : failed(PULL_ERROR_MESSAGE[errorCode((res.error as PoolError).code)]);
  }
  entry.outcome = outcome;
  const state = store.pulls.get(entry.pullId);
  // Skip a row another pull has since replaced (the same call listed again).
  if (state && state.progress.rows[entry.index]?.callId === callId) applyRow(state.progress, entry.index, rowFor(entry.meta, outcome));
  return outcome;
}

/** The pull id of a call opened by its address that no pull listed. It belongs to no pull, so no eviction of a pull drops it. */
const OPENED = "opened";
/** How many such calls the store keeps. The oldest goes first. */
export const MAX_OPENED = 50;
/** How many single-call fetches may be under way (on the wire or waiting for a slot): the five slots and two waiting. */
export const MAX_OPEN_FETCHES = POOL_SIZE + 2;
/** How many Retell 404s are remembered. */
const MAX_MISSING = 200;

/**
 * Fetches one call that is not in the store (a call opened by its address), analyzes it and keeps a report or a
 * no_content answer, so the next open makes no request. Goes through the shared limiter like every other Retell
 * request. Null when there is nothing to show: no usable key, Retell does not have the call, the call has not ended,
 * or the request failed; also null, with no request, when too many fetches are under way already (another site must
 * not be able to queue Retell requests by looping over made-up ids) or Retell already said 404 for this id. An error outcome is returned but not kept, so the next open tries again. Two callers for one
 * call share one request. Disconnect during the request means nothing is kept.
 */
export function fetchCall(callId: string, opts: { analyze: Analyze; key?: string } & PullTuning): Promise<Outcome | null> {
  const store = getStore();
  const running = store.fetching.get(callId);
  if (running) return running;
  if (store.missing.has(callId) || store.fetching.size >= MAX_OPEN_FETCHES) return Promise.resolve(null);
  const p = fetchOne(store, callId, opts).finally(() => {
    if (store.fetching.get(callId) === p) store.fetching.delete(callId);
  });
  store.fetching.set(callId, p);
  return p;
}

async function fetchOne(store: Store, callId: string, opts: { analyze: Analyze; key?: string } & PullTuning): Promise<Outcome | null> {
  const epoch = store.epoch;
  const key = opts.key ?? (await readStoredKey());
  if (key === null || store.epoch !== epoch) return null;
  const task = async (): Promise<{ meta: CallMeta; outcome: Outcome } | null> => {
    // Disconnect while this waited for a slot: the key is no longer ours to send.
    if (store.epoch !== epoch) return null;
    const raw = await getCall(key, callId, opts);
    const meta = toMeta(raw);
    // The list only shows calls that have ended; a call opened by address follows the same rule.
    if (meta === null || meta.callId !== callId || meta.callStatus !== "ended") return null;
    return { meta, outcome: safeAnalyze(opts.analyze, raw, callId) };
  };
  const [res] = await runPool([task], {
    size: 1,
    limiter: store.limiter,
    sleep: opts.sleep ?? defaultSleep,
    jitter: opts.jitter ?? defaultJitter,
    now: opts.now,
    onWait: () => {},
    shouldStop: () => store.epoch !== epoch,
  });
  if (!res.ok && res.error.status === 404 && store.epoch === epoch) {
    if (store.missing.size >= MAX_MISSING) store.missing.clear();
    store.missing.add(callId);
  }
  if (!res.ok || res.value === null) return null;
  const { meta, outcome } = res.value;
  // Disconnect happened while the request ran, or a pull has listed the call since: leave the store as it is.
  if (store.epoch !== epoch) return null;
  if (outcome.kind === "error" || store.calls.has(callId)) return outcome;
  store.calls.set(callId, { meta, outcome, analyze: opts.analyze, pullId: OPENED, index: -1 });
  const opened = [...store.calls].filter(([, e]) => e.pullId === OPENED);
  for (const [id] of opened.slice(0, Math.max(0, opened.length - MAX_OPENED))) store.calls.delete(id);
  return outcome;
}

/**
 * One get-call request for a pin, through the shared limiter like every other Retell request. The raw record goes to
 * the caller and is kept nowhere here. A Disconnect while it waits or runs ends it as "cancelled".
 */
export async function fetchRecord(callId: string, key: string, opts: PullTuning = {}): Promise<PoolResult<unknown>> {
  return runLimited(() => getCall(key, callId, opts), opts);
}

/** The count of Disconnects and key replacements so far. A job that must not outlive one reads it first and passes it to runLimited. */
export const currentEpoch = (): number => getStore().epoch;

/**
 * One Retell request of any kind, through the shared limiter like every other: five in flight and one 429 pause across the
 * app. `retries` is how many times a 429 or 5xx is tried again (default 4; zero for a request that is not safe to repeat,
 * such as starting a call). A Disconnect while it waits or runs ends it as "cancelled", and its answer is dropped. With `epoch` (from currentEpoch) the
 * Disconnect is counted from that moment, not from this call, so a job of several requests stops as a whole.
 */
export async function runLimited<T>(task: () => Promise<T>, opts: PullTuning & { retries?: number; epoch?: number } = {}): Promise<PoolResult<T>> {
  const store = getStore();
  const epoch = opts.epoch ?? store.epoch;
  const [res] = await runPool([task], {
    size: 1,
    limiter: store.limiter,
    sleep: opts.sleep ?? defaultSleep,
    jitter: opts.jitter ?? defaultJitter,
    now: opts.now,
    onWait: () => {},
    shouldStop: () => store.epoch !== epoch,
    maxRetries: opts.retries,
  });
  // Disconnect happened while the request ran: the answer is not ours to use.
  return store.epoch !== epoch ? { ok: false, error: { code: "cancelled" } } : res;
}
