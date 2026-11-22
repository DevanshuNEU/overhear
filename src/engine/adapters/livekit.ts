// The LiveKit adapter: the JSON of a LiveKit Agents SessionReport in, the engine's evidence out. The input is what
// SessionReport.to_dict() (Python) writes, or the Node SDK's sessionReportToJSON. Every fact about the shape comes
// from docs/research/livekit-facts.md (pinned to livekit-agents 1.8.13); a section is cited where it is used.
//
// Items keep the history's order and nothing is dropped, as in the Retell adapter: anything that is not a readable
// turn, tool call or tool result becomes an event.
import { LIVEKIT_NO_CALL_ID, NOT_A_LIVEKIT_REPORT } from "@/report/labels";
import type { Evidence, Item } from "@/report/schema";
import { InputError } from "../types";
import type { Adapted } from "./retell";

export type { Adapted } from "./retell";

type Rec = Record<string, unknown>;
type CallFields = Evidence["callFields"];

/** Instructions longer than this are cut in an event: an agent's prompt can be long and is not evidence. */
const INSTRUCTIONS_MAX = 500;

/** A timestamp above this is milliseconds. Epoch seconds stay below 1e11 until the year 5138. */
const MS_THRESHOLD = 1e12;

/**
 * LiveKit's close reasons in the words the engine already reads (Retell's disconnection reasons). Source: the research
 * doc, section 3 and the mapping table. The report writes proto names (CR_*); the close event writes lowercase.
 * participant_disconnected is a caller hang-up. user_initiated is the agent or developer code closing the session
 * (the built-in end_call tool shuts down with it), not the user. CR_COMPLETED is the proto name the research doc
 * found for task_completed; the CR_TASK_COMPLETED spelling is kept too. Anything else passes through lowercased.
 */
const DISCONNECTION_REASON: Record<string, string> = {
  CR_PARTICIPANT_DISCONNECTED: "user_hangup",
  participant_disconnected: "user_hangup",
  CR_USER_INITIATED: "agent_hangup",
  user_initiated: "agent_hangup",
  CR_TASK_COMPLETED: "agent_hangup",
  CR_COMPLETED: "agent_hangup",
  task_completed: "agent_hangup",
  CR_ERROR: "error_livekit",
  error: "error_livekit",
};

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v !== "";
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Epoch seconds from a LiveKit timestamp: seconds as floats, or milliseconds when the Node SDK wrote them. */
const seconds = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n > MS_THRESHOLD ? n / 1000 : n;
};

/** True for an object with chat_history.items as an array and at least one of job_id, room_id, sdk_version. */
export function isLiveKitReport(raw: unknown): raw is Rec {
  if (!isRec(raw) || !isRec(raw.chat_history) || !Array.isArray(raw.chat_history.items)) return false;
  return "job_id" in raw || "room_id" in raw || "sdk_version" in raw;
}

/** Reads one session report. Throws InputError when it is not one or has no id to name the call by. */
export function fromLiveKit(raw: unknown): Adapted {
  if (!isLiveKitReport(raw)) throw new InputError(NOT_A_LIVEKIT_REPORT.message, NOT_A_LIVEKIT_REPORT.fix);
  const callId = [raw.job_id, raw.room_id, raw.room].find(isId);
  if (callId === undefined) throw new InputError(LIVEKIT_NO_CALL_ID.message, LIVEKIT_NO_CALL_ID.fix);

  const history = (raw.chat_history as Rec).items as unknown[];
  const hasMessage = history.some((it) => isRec(it) && it.type === "message" && (it.role === "assistant" || it.role === "user"));
  if (!hasMessage) return { kind: "no_content", callId, reason: "no_transcript" };

  const startMs = callStartMs(raw, history);
  const evidence: Evidence = {
    callId,
    platform: "livekit",
    // sdk_version is the library, not the agent, and no prompt or deployment version is in the report (research doc, mapping table).
    agentVersion: null,
    tier: 1,
    ordering: "sequence",
    callFields: callFields(raw),
    callStartMs: startMs,
    items: readItems(history, startMs === null ? null : startMs / 1000),
    // No missing_tool_transcript gap, even with no function_call or function_call_output items: LiveKit always records
    // tool calls in the chat history, so an empty list means none were made (research doc, section 2 and mapping table).
    gaps: [],
  };
  const name = typeof raw.agent_name === "string" ? raw.agent_name.trim() : "";
  return { kind: "evidence", evidence, source: "chat_history", agentId: name === "" ? null : name };
}

/**
 * When the call started, in epoch milliseconds: the report's timestamp (taken at session end) minus its duration, else
 * the first item's created_at. When both exist the earlier wins, so no item ever starts before the call (research doc, section 4).
 */
function callStartMs(raw: Rec, history: unknown[]): number | null {
  const end = seconds(raw.timestamp);
  const duration = num(raw.duration_ms);
  const fromDuration = end !== null && duration !== null ? end - duration / 1000 : null;
  const first = history.find((it) => isRec(it) && seconds(it.created_at) !== null);
  const fromFirst = isRec(first) ? seconds(first.created_at) : null;
  const candidates = [fromDuration, fromFirst].filter((v): v is number => v !== null);
  if (candidates.length === 0) return null;
  const ms = Math.round(Math.min(...candidates) * 1000);
  return ms >= 0 ? ms : null;
}

/** The call fields the schema allows. A missing close reason stays missing. */
function callFields(raw: Rec): CallFields {
  const out: CallFields = { call_type: "livekit_session" };
  const duration = num(raw.duration_ms);
  if (duration !== null) out.duration_ms = duration;
  if (typeof raw.close_reason === "string" && raw.close_reason !== "") {
    out.disconnection_reason = DISCONNECTION_REASON[raw.close_reason] ?? raw.close_reason.toLowerCase();
  }
  return out;
}

/** Every history item as an item, numbered from 1. An output is a tool_result only when its call_id names a tool call. */
function readItems(history: unknown[], startSec: number | null): Item[] {
  const toolCallIds = new Set<string>();
  for (const it of history) if (isRec(it) && it.type === "function_call" && isId(it.call_id) && typeof it.name === "string") toolCallIds.add(it.call_id);
  const claimed = new Set<string>();
  return history.map((it, i) => readItem(it, i + 1, startSec, toolCallIds, claimed));
}

function readItem(it: unknown, seq: number, startSec: number | null, toolCallIds: Set<string>, claimed: Set<string>): Item {
  if (!isRec(it)) return { kind: "event", seq, type: "unknown", data: it };
  const type = typeof it.type === "string" ? it.type : "unknown";

  if (type === "message" && (it.role === "assistant" || it.role === "user")) {
    const at = seconds(isRec(it.metrics) ? it.metrics.started_speaking_at : undefined) ?? seconds(it.created_at);
    return {
      kind: "turn",
      seq,
      role: it.role === "assistant" ? "agent" : "caller",
      text: textOf(it.content),
      startSec: at === null || startSec === null ? null : Math.max(0, at - startSec),
      interrupted: typeof it.interrupted === "boolean" ? it.interrupted : null,
    };
  }
  // A call_id's first function_call is the tool call; a later one with the same id is an event, so ids stay unique.
  if (type === "function_call" && isId(it.call_id) && typeof it.name === "string" && !claimed.has(it.call_id)) {
    claimed.add(it.call_id);
    return { kind: "tool_call", seq, id: it.call_id, name: it.name, args: readArgs(it.arguments) };
  }
  if (type === "function_call_output" && isId(it.call_id) && toolCallIds.has(it.call_id)) {
    // is_error only says the tool raised, the same weak meaning as Retell's successful (research doc, section 2).
    return { kind: "tool_result", seq, id: it.call_id, ok: null, platformOk: typeof it.is_error === "boolean" ? !it.is_error : null, payload: readOutput(it.output) };
  }
  return { kind: "event", seq, type, data: eventData(it) };
}

/** A message's text: the string parts of content joined with one space. Images and audio are not text. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.filter((p): p is string => typeof p === "string").join(" ") : "";
}

/** Tool arguments: LiveKit writes a JSON string. An object is taken as is, and anything else reads as {}. */
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

/** A tool's output, JSON-parsed when it parses; plain text such as an error message stays text. */
function readOutput(raw: unknown): unknown {
  if (raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** The item as event data: the item whole, with instructions text cut to its first 500 characters and an ellipsis. */
function eventData(it: Rec): Rec {
  const { instructions, ...rest } = it;
  if (typeof instructions !== "string") return it;
  return { ...rest, instructions: instructions.length > INSTRUCTIONS_MAX ? `${instructions.slice(0, INSTRUCTIONS_MAX)}…` : instructions };
}
