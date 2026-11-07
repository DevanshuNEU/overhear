// The Retell adapter: one get-call record in, the engine's evidence out (spec 6.1).
//
// Reading order (round 7 audit): transcript_with_tool_calls, else scrubbed_transcript_with_tool_calls, else
// transcript_object, which has turns only, so its evidence has no order between speech and tools and carries a
// missing_tool_transcript gap. With none of them the call is no_content, with the reason. An empty list counts as
// absent, so an empty record never reads as a clean call.
//
// Items keep Retell's order and nothing is dropped: anything that is not a readable turn, tool call or tool result
// becomes an event. Streamed fragments stay separate items. Merging them would renumber seqs and could move words
// across a tool call, and promise_backed depends on that order.
import { NOT_A_RETELL_CALL, type NoContentReason } from "@/report/labels";
import type { Evidence, Item } from "@/report/schema";
import { InputError, type Outcome } from "../types";
import { GAP_DETAIL } from "../wording";

export type TranscriptSource = "transcript_with_tool_calls" | "scrubbed_transcript_with_tool_calls" | "transcript_object";

/** Evidence and the transcript it was read from, or no_content with the reason. */
export type Adapted = { kind: "evidence"; evidence: Evidence; source: TranscriptSource } | Extract<Outcome, { kind: "no_content" }>;

type Rec = Record<string, unknown>;
type CallFields = Evidence["callFields"];

const SOURCES: TranscriptSource[] = ["transcript_with_tool_calls", "scrubbed_transcript_with_tool_calls", "transcript_object"];

/** Disconnection reasons that mean nobody was ever on the line: a dial that failed or a web caller who never joined. */
const NEVER_CONNECTED = new Set<unknown>([
  "dial_busy",
  "dial_failed",
  "dial_no_answer",
  "invalid_destination",
  "telephony_provider_permission_denied",
  "telephony_provider_unavailable",
  "sip_routing_error",
  "marked_as_spam",
  "user_declined",
  "registered_call_timeout",
  "error_user_not_joined",
]);

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v !== "";

/**
 * Reads one Retell call: the body of GET /v2/get-call/{call_id}, or a saved webhook or custom-function body that
 * holds it under `call`. Throws InputError only when there is no call to read (not an object, or no call_id).
 */
export function fromRetell(raw: unknown): Adapted {
  const call = unwrap(raw);
  const callId = call.call_id as string;
  const source = SOURCES.find((key) => Array.isArray(call[key]) && call[key].length > 0);
  if (!source) return { kind: "no_content", callId, reason: noContentReason(call) };

  const withTools = source !== "transcript_object";
  const evidence: Evidence = {
    callId,
    platform: "retell",
    agentVersion: agentVersion(call.agent_version),
    tier: 1,
    ordering: withTools ? "sequence" : "none",
    callFields: callFields(call),
    callStartMs: Number.isSafeInteger(call.start_timestamp) && (call.start_timestamp as number) >= 0 ? (call.start_timestamp as number) : null,
    items: readItems(call[source] as unknown[]),
    gaps: withTools ? [] : [{ code: "missing_tool_transcript", detail: GAP_DETAIL.missing_tool_transcript, seqs: [] }],
  };
  return { kind: "evidence", evidence, source };
}

/** The call record itself, out of a webhook or custom-function body when it is wrapped in one. */
function unwrap(raw: unknown): Rec {
  const call = isRec(raw) && !("call_id" in raw) && isRec(raw.call) ? raw.call : raw;
  if (!isRec(call) || !isId(call.call_id)) throw new InputError(NOT_A_RETELL_CALL.message, NOT_A_RETELL_CALL.fix);
  return call;
}

/** Why a call with no transcript has none. Never connected wins: such a call had nothing to store. */
function noContentReason(call: Rec): NoContentReason {
  if (call.call_status === "not_connected" || NEVER_CONNECTED.has(call.disconnection_reason)) return "never_connected";
  if (call.data_storage_setting === "basic_attributes_only" || call.opt_out_sensitive_data_storage === true) return "storage_stripped";
  return "no_transcript";
}

/** Retell's agent version as text: a number becomes its digits, so version 0 is "0" and not missing. */
function agentVersion(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" ? v : null;
}

/** The call fields the schema allows, each copied only when it has the right type. Links, tokens and latency stay out. */
function callFields(call: Rec): CallFields {
  const out: CallFields = {};
  if (typeof call.call_type === "string") out.call_type = call.call_type;
  if (typeof call.disconnection_reason === "string") out.disconnection_reason = call.disconnection_reason;
  if (typeof call.duration_ms === "number" && Number.isFinite(call.duration_ms)) out.duration_ms = call.duration_ms;
  const a = call.call_analysis;
  if (isRec(a)) {
    const analysis: NonNullable<CallFields["call_analysis"]> = {};
    if (typeof a.call_successful === "boolean") analysis.call_successful = a.call_successful;
    if (typeof a.call_summary === "string") analysis.call_summary = a.call_summary;
    if (typeof a.user_sentiment === "string") analysis.user_sentiment = a.user_sentiment;
    if (typeof a.in_voicemail === "boolean") analysis.in_voicemail = a.in_voicemail;
    if (isRec(a.custom_analysis_data)) analysis.custom_analysis_data = a.custom_analysis_data;
    out.call_analysis = analysis;
  }
  return out;
}

/**
 * Every utterance as an item, numbered from 1 in Retell's order. The first invocation of each tool_call_id is the
 * tool call; a later one with the same id is an event. A result is a tool_result when its id names a tool call
 * anywhere in the list, and an event otherwise, since the schema rejects a result that matches no tool call.
 */
function readItems(list: unknown[]): Item[] {
  const toolCallIds = new Set<string>();
  const toolCallAt = new Set<number>();
  list.forEach((u, i) => {
    if (isRec(u) && u.role === "tool_call_invocation" && isId(u.tool_call_id) && typeof u.name === "string" && !toolCallIds.has(u.tool_call_id)) {
      toolCallIds.add(u.tool_call_id);
      toolCallAt.add(i);
    }
  });
  return list.map((u, i) => readItem(u, i + 1, toolCallAt.has(i), toolCallIds));
}

/** One utterance as an item. An unreadable one is an event named for its role ("unknown" without one), kept whole. */
function readItem(u: unknown, seq: number, isToolCall: boolean, toolCallIds: Set<string>): Item {
  if (!isRec(u)) return { kind: "event", seq, type: "unknown", data: u };
  const { role, ...rest } = u;
  if ((role === "agent" || role === "user") && typeof u.content === "string") {
    return { kind: "turn", seq, role: role === "agent" ? "agent" : "caller", text: u.content, startSec: firstWordStart(u.words), interrupted: null };
  }
  if (isToolCall) return { kind: "tool_call", seq, id: u.tool_call_id as string, name: u.name as string, args: readArgs(u.arguments) };
  if (role === "tool_call_result" && isId(u.tool_call_id) && toolCallIds.has(u.tool_call_id)) {
    const platformOk = typeof u.successful === "boolean" ? u.successful : null;
    return { kind: "tool_result", seq, id: u.tool_call_id, ok: null, platformOk, payload: readContent(u.content) };
  }
  return typeof role === "string" ? { kind: "event", seq, type: role, data: rest } : { kind: "event", seq, type: "unknown", data: u };
}

/** When the turn starts, from its first word's timestamp; null when Retell gave none. */
function firstWordStart(words: unknown): number | null {
  const first = Array.isArray(words) ? words[0] : undefined;
  return isRec(first) && typeof first.start === "number" && Number.isFinite(first.start) ? first.start : null;
}

/** Tool arguments as an object. Retell sends a JSON string; an object is taken as is, and anything else reads as {}. */
function readArgs(raw: unknown): Record<string, unknown> {
  if (isRec(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRec(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** A tool result's content, JSON-parsed when it parses; plain text such as "OK" stays text. */
function readContent(raw: unknown): unknown {
  if (raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
