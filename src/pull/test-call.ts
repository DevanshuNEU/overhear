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
import { TEST_CALL_KEY_IN_CALL_MESSAGE, TEST_CALL_TIMEOUT_MESSAGE, type TestCallErrorCode } from "./labels";
import type { PoolError } from "./pool";
import { runLimited, type PullTuning } from "./pull";
import { redact } from "./redact";
import { createWebCall, getCall, listAgents, readStoredKey, RETELL_ID, type AgentChoice, type WebCall } from "./retell-source";

/** How long one test call holds the slot if nobody asks for its result: 15 minutes. */
export const ACTIVE_TEST_CALL_MS = 15 * 60 * 1000;
/** How long a call may be "processing" (counted from the first ask for its result) before the answer is a plain message. */
export const RESULT_TIMEOUT_MS = 2 * 60 * 1000;
/** How many started calls are remembered, newest last. */
const MAX_KNOWN = 20;

export type TestCallResult = { status: "processing" } | { status: "ready"; outcome: Outcome } | { status: "timeout"; message: string };

type Deps = { tuning?: PullTuning };
type Fail = { ok: false; code: TestCallErrorCode };
const refuse = (code: TestCallErrorCode): Fail => ({ ok: false, code });

type State = {
  /** The call that holds the slot: callId is null while Retell is still being asked to start it. */
  active: { callId: string | null; since: number } | null;
  /** The calls this server started, with the time their result was first asked for. */
  known: Map<string, { polledAt: number | null }>;
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
    if (!made.ok) {
      // Retell would not start a call with this agent (it is gone, or not a voice agent).
      const refused = made.error.status === 400 || made.error.status === 404 || made.error.status === 422;
      return release(state, slot, refuse(refused ? "bad_agent" : failureCode(made.error)));
    }
    // A call that holds the key (a Retell that echoes it) is not passed on: the browser must never get it.
    if (holdsKey(made.value, key)) return release(state, slot, refuse("unreadable"));
    slot.callId = made.value.callId;
    state.known.set(made.value.callId, { polledAt: null });
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
 * Where a test call stands: processing until Retell has ended it and its transcript with tool calls is there, then the
 * engine's outcome, or a plain timeout message once the wait has run about two minutes. Only for a call this server
 * started. One get-call request per ask. Never throws.
 */
export async function testCallResult(callId: string, deps: Deps = {}): Promise<{ ok: true; result: TestCallResult } | Fail> {
  if (!RETELL_ID.test(callId)) return refuse("bad_call_id");
  const state = getState();
  const known = state.known.get(callId);
  if (!known) return refuse("not_found");
  try {
    const key = await readStoredKey();
    if (key === null) return refuse("not_connected");
    known.polledAt ??= clock(deps);
    const fetched = await runLimited(() => getCall(key, callId, deps.tuning), deps.tuning);
    if (!fetched.ok) return refuse(failureCode(fetched.error));
    const raw = fetched.value;
    if (!isRec(raw) || raw.call_id !== callId) return refuse("unreadable");

    const status = raw.call_status;
    // The call is over (however it ended): the slot is free whether or not Retell has the transcript yet.
    if (status === "ended" || status === "error" || status === "not_connected") {
      if (state.active?.callId === callId) state.active = null;
    }
    if (status === "ended" && Array.isArray(raw.transcript_with_tool_calls)) {
      return { ok: true, result: { status: "ready", outcome: safeOutcome(analyze(raw, callId), callId, key) } };
    }
    if (clock(deps) - known.polledAt >= RESULT_TIMEOUT_MS) {
      if (state.active?.callId === callId) state.active = null;
      return { ok: true, result: { status: "timeout", message: TEST_CALL_TIMEOUT_MESSAGE } };
    }
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
