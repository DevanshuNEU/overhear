// The test call line: list the user's agents, start a browser test call to one of them, and, after the call, fetch what Retell
// recorded and run the engine on it. The only code that reads the stored key for these three jobs.
//
// Starting a call, in order, each step refusing before the next:
//   1. The agent id has the id shape (nothing reaches Retell before that), and a key is stored.
//   2. One test call at a time: the slot is taken before the first request, so two starts together make one call. The slot
//      is freed when the start fails, when the result shows the call has ended or the wait is over, on Disconnect, and
//      after ACTIVE_TEST_CALL_MS whatever happens (a tab that closed before the call ended never asks again).
//   3. The agent must be in Retell's fresh list of this key's voice agents.
//   4. The web call is created once (a 5xx or 429 is not tried again, so one start is never two calls). Only the four
//      fields the browser needs leave this file (see createWebCall); the access token is a per-call credential.
//
// The result of a call this server started: one get-call request per ask, through the shared limiter, never a loop. The
// client asks again until the answer is "ready" or "timeout". The wait counts from the first ask. The outcome is the engine's
// own, for the full record as a pulled call is read (analyzeCall), so the verdict matches the call screen.
//
// Every failure is a TestCallErrorCode with a fixed sentence (TEST_CALL_MESSAGE), never a word of Retell's answer or the key.
import type { Outcome } from "@/engine/types";
import { analyzeCall } from "./analyzer";
import { KeyStoreError } from "./key-store";
import { TEST_CALL_DID_NOT_CONNECT_MESSAGE, TEST_CALL_KEY_IN_CALL_MESSAGE, TEST_CALL_TIMEOUT_MESSAGE, type TestCallErrorCode } from "./labels";
import type { PoolError } from "./pool";
import { runLimited, type PullTuning } from "./pull";
import { redact } from "./redact";
import { createWebCall, getCall, listAgents, readStoredKey, RETELL_ID, type AgentChoice, type WebCall } from "./retell-source";

/** How long one test call holds the slot if nobody asks for its result: 15 minutes. */
export const ACTIVE_TEST_CALL_MS = 15 * 60 * 1000;
/** How long a call that Retell has ended may be "processing" (counted from when it first showed as ended) before the answer is a plain message. */
export const RESULT_TIMEOUT_MS = 2 * 60 * 1000;
/** How long an ended call with an empty transcript is waited on, in case Retell fills it in, before it is read as it is (no_content). */
export const EMPTY_TRANSCRIPT_GRACE_MS = 30 * 1000;
/** How long the slot is held after a network failure on the create, which may have reached Retell: a retry in that time is not a second call. */
export const NETWORK_HOLD_MS = 10 * 1000;
/** How many started calls are remembered, newest last. */
const MAX_KNOWN = 20;

export type TestCallResult =
  | { status: "processing" }
  | { status: "ready"; outcome: Outcome }
  | { status: "timeout"; message: string }
  | { status: "did_not_connect"; message: string };
type ResultAnswer = { ok: true; result: TestCallResult } | Fail;

type Deps = { tuning?: PullTuning };
type Fail = { ok: false; code: TestCallErrorCode };
const refuse = (code: TestCallErrorCode): Fail => ({ ok: false, code });

type Known = { endedAt: number | null; inflight: Promise<ResultAnswer> | null };
type State = {
  /** The call that holds the slot: callId is null while Retell is still being asked to start it. */
  active: { callId: string | null; since: number } | null;
  /** The calls this server started: when Retell first showed each as over, and the ask for its result that is under way. */
  known: Map<string, Known>;
};

const g = globalThis as typeof globalThis & { __overhearTestCalls?: State };
// Read on every use, so a reset of the global (tests) takes effect.
const getState = (): State => (g.__overhearTestCalls ??= { active: null, known: new Map() });

/** Forgets every started call and frees the slot. Disconnect calls it, with the key. */
export function clearTestCalls(): void {
  g.__overhearTestCalls = undefined;
}

const clock = (deps: Deps): number => (deps.tuning?.now ?? Date.now)();

/** A failed request as a code. A status with no named cause is "network"; an unreadable answer has no status. */
function failureCode(error: PoolError): TestCallErrorCode {
  switch (error.code) {
    case "bad_key":
    case "rate_limited":
    case "retell_down":
    case "network":
      return error.code;
    case "cancelled":
      return "not_connected";
    default:
      if (error.status === 404) return "not_found";
      return error.status === undefined ? "unreadable" : "network";
  }
}

/** A thrown error as a code. The thrown message is never kept. */
const thrownCode = (err: unknown): TestCallErrorCode => (err instanceof KeyStoreError ? "not_connected" : "failed");

/** An agent whose id holds the key is dropped, and a name that holds it is shown as the id: a Retell that echoes the key must not pass it on. */
function scrub(agents: AgentChoice[], key: string): AgentChoice[] {
  return agents.filter((a) => !a.id.includes(key)).map((a) => (a.name.includes(key) ? { id: a.id, name: a.id } : a));
}

/** The user's voice agents on the stored key, as id and name, sorted by name. A fresh request every time. */
export async function listAgentChoices(deps: Deps = {}): Promise<{ ok: true; agents: AgentChoice[] } | Fail> {
  try {
    const key = await readStoredKey();
    if (key === null) return refuse("not_connected");
    const listed = await runLimited(() => listAgents(key, deps.tuning), deps.tuning);
    return listed.ok ? { ok: true, agents: scrub(listed.value, key) } : refuse(failureCode(listed.error));
  } catch (err) {
    return refuse(thrownCode(err));
  }
}

/** Starts a web call to one of the user's agents. Never throws: every way it can stop is a code. */
export async function startTestCall(agentId: unknown, deps: Deps = {}): Promise<{ ok: true; call: WebCall } | Fail> {
  if (typeof agentId !== "string" || !RETELL_ID.test(agentId)) return refuse("bad_agent");
  const state = getState();
  let slot: State["active"] = null;
  try {
    const key = await readStoredKey();
    if (key === null) return refuse("not_connected");
    // The check and the take run with no await between them.
    const now = clock(deps);
    if (state.active && now - state.active.since < ACTIVE_TEST_CALL_MS) return refuse("call_active");
    slot = { callId: null, since: now };
    state.active = slot;

    const listed = await runLimited(() => listAgents(key, deps.tuning), deps.tuning);
    if (!listed.ok) return release(state, slot, refuse(failureCode(listed.error)));
    if (!scrub(listed.value, key).some((agent) => agent.id === agentId)) return release(state, slot, refuse("bad_agent"));

    const made = await runLimited(() => createWebCall(key, agentId, deps.tuning), { ...deps.tuning, retries: 0 });
    if (!made.ok && made.error.code === "network") {
      // The request may have reached Retell. Keep the slot a little longer (it ends NETWORK_HOLD_MS from now), so an
      // immediate retry is not a second call.
      slot.since = clock(deps) - ACTIVE_TEST_CALL_MS + NETWORK_HOLD_MS;
      return refuse("network");
    }
    if (!made.ok) {
      // Retell would not start a call with this agent (it is gone, or not a voice agent).
      const refused = made.error.status === 400 || made.error.status === 404 || made.error.status === 422;
      return release(state, slot, refuse(refused ? "bad_agent" : failureCode(made.error)));
    }
    // A call that holds the key (a Retell that echoes it) is not passed on: the browser must never get it.
    if (holdsKey(made.value, key)) return release(state, slot, refuse("unreadable"));
    slot.callId = made.value.callId;
    state.known.set(made.value.callId, { endedAt: null, inflight: null });
    for (const id of [...state.known.keys()].slice(0, Math.max(0, state.known.size - MAX_KNOWN))) state.known.delete(id);
    return { ok: true, call: made.value };
  } catch (err) {
    return release(state, slot, refuse(thrownCode(err)));
  }
}

/** Frees the slot if it is still the one this start took, and passes the failure on. */
function release(state: State, slot: State["active"], failure: Fail): Fail {
  if (slot !== null && state.active === slot) state.active = null;
  return failure;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when the value's JSON text holds the key, as it is or as JSON writes it (a quote or backslash in it is escaped). */
function holdsKey(value: unknown, key: string): boolean {
  const text = JSON.stringify(value);
  return text.includes(key) || text.includes(JSON.stringify(key).slice(1, -1));
}

/** The engine's outcome with anything that could carry the key taken out. The engine's message for a record it cannot read can quote the record. */
function safeOutcome(outcome: Outcome, callId: string, key: string): Outcome {
  if (holdsKey(outcome, key)) return { kind: "error", callId, message: TEST_CALL_KEY_IN_CALL_MESSAGE };
  return outcome.kind === "error" ? { ...outcome, message: redact(outcome.message, key) } : outcome;
}

/**
 * Where a test call stands. While Retell has it registered or ongoing: processing, with no timeout (the slot's own cap covers a
 * tab that was abandoned). Once it has ended: processing until its transcript with tool calls is there, then the engine's
 * outcome. An empty transcript is waited on for EMPTY_TRANSCRIPT_GRACE_MS from when the call first showed as ended, then
 * read as it is. A call that never filled in is a plain timeout message RESULT_TIMEOUT_MS after it ended. A call that ended
 * in error or never connected is answered at once. Only for a call this server started. One get-call request per ask, and
 * asks for one call that arrive together share it. Never throws.
 */
export function testCallResult(callId: string, deps: Deps = {}): Promise<ResultAnswer> {
  if (!RETELL_ID.test(callId)) return Promise.resolve(refuse("bad_call_id"));
  const known = getState().known.get(callId);
  if (!known) return Promise.resolve(refuse("not_found"));
  if (known.inflight) return known.inflight;
  const run = resultOf(callId, known, deps).finally(() => {
    if (known.inflight === run) known.inflight = null;
  });
  known.inflight = run;
  return run;
}

async function resultOf(callId: string, known: Known, deps: Deps): Promise<ResultAnswer> {
  const state = getState();
  const freeSlot = () => {
    if (state.active?.callId === callId) state.active = null;
  };
  try {
    const key = await readStoredKey();
    if (key === null) return refuse("not_connected");
    const fetched = await runLimited(() => getCall(key, callId, deps.tuning), deps.tuning);
    if (!fetched.ok) return refuse(failureCode(fetched.error));
    const raw = fetched.value;
    if (!isRec(raw) || raw.call_id !== callId) return refuse("unreadable");

    const status = raw.call_status;
    const now = clock(deps);
    if (status === "error" || status === "not_connected") {
      freeSlot();
      return { ok: true, result: { status: "did_not_connect", message: TEST_CALL_DID_NOT_CONNECT_MESSAGE } };
    }
    if (status !== "ended") return { ok: true, result: { status: "processing" } };

    // The call is over: the slot is free whether or not Retell has the transcript yet.
    freeSlot();
    known.endedAt ??= now;
    const transcript = raw.transcript_with_tool_calls;
    if (Array.isArray(transcript) && (transcript.length > 0 || now - known.endedAt >= EMPTY_TRANSCRIPT_GRACE_MS)) {
      return { ok: true, result: { status: "ready", outcome: safeOutcome(analyze(raw, callId), callId, key) } };
    }
    if (now - known.endedAt >= RESULT_TIMEOUT_MS) return { ok: true, result: { status: "timeout", message: TEST_CALL_TIMEOUT_MESSAGE } };
    return { ok: true, result: { status: "processing" } };
  } catch (err) {
    return refuse(thrownCode(err));
  }
}

function analyze(raw: unknown, callId: string): Outcome {
  try {
    return analyzeCall(raw);
  } catch {
    // The thrown message could quote the record. Say only that it failed.
    return { kind: "error", callId, message: "Could not check this call." };
  }
}
