// Trims a Retell call record to what a pin keeps on disk. This is an allowlist, not a blocklist: a field is dropped
// unless it is named here, so a field Retell adds later is dropped too. What stays is what the engine needs to read
// the call again: ids, status, timing, disconnection, three analysis flags and the one transcript the adapter
// reads. Left out on purpose: the access token, every recording, log and signed link, phone numbers, SIP headers,
// metadata and dynamic variables, the summary, cost and latency. Tool arguments and results are never altered,
// because the verdict depends on them.
//
// Pure: no clock, no disk, no network. The input is never changed; the answer shares nothing with it. Every read is
// of an own property, so nothing is picked up from a prototype. A record that cannot be copied (nested so deep that
// the copy overflows the stack) gives an empty record: nothing is kept rather than something half-trimmed.

type Rec = Record<string, unknown>;

/** Top-level fields kept as they are, when they hold a plain value (text, a finite number or a boolean). */
const KEPT_SCALARS = [
  "call_id",
  "agent_id",
  "agent_version",
  "call_status",
  "call_type",
  "start_timestamp",
  "duration_ms",
  "disconnection_reason",
  "data_storage_setting",
  "opt_out_sensitive_data_storage",
] as const;

/** The analysis fields kept, with the type each must have. The summary and the custom data can name the caller. */
const KEPT_ANALYSIS = { call_successful: "boolean", user_sentiment: "string", in_voicemail: "boolean" } as const;

/** The transcripts in the order the adapter reads them: the first one that is a non-empty list wins, the rest go. */
const TRANSCRIPTS = ["transcript_with_tool_calls", "scrubbed_transcript_with_tool_calls", "transcript_object"] as const;

/** Fields dropped from every kept utterance: an opaque model value, not evidence of what was said or done. */
const DROPPED_FROM_UTTERANCES = ["thought_signature"] as const;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isPlain = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
const has = (o: Rec, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** The record itself, out of a webhook or custom-function body when it is wrapped in one (as the adapter does). */
function unwrap(raw: unknown): Rec {
  if (!isRec(raw)) return {};
  return !has(raw, "call_id") && has(raw, "call") && isRec(raw.call) ? raw.call : raw;
}

const withoutUrl = (m: Rec): Rec => Object.fromEntries(Object.entries(m).filter(([k]) => k !== "url"));

/** An SMS's attachments without their links. A list keeps its objects, a single object is cleaned, anything else goes. */
function cleanMultimedia(m: unknown): unknown {
  if (Array.isArray(m)) return m.filter(isRec).map(withoutUrl);
  return isRec(m) ? withoutUrl(m) : undefined;
}

/** A copy of one utterance. An SMS keeps its words but loses the link of each attachment; anything else stays whole. */
function keepUtterance(u: unknown): unknown {
  const copy = structuredClone(u);
  if (!isRec(copy)) return copy;
  for (const key of DROPPED_FROM_UTTERANCES) delete copy[key];
  if (copy.role === "sms" && has(copy, "multimedia")) {
    const media = cleanMultimedia(copy.multimedia);
    if (media === undefined) delete copy.multimedia;
    else copy.multimedia = media;
  }
  return copy;
}

/** The call_analysis kept: only the three allowed fields, each only with the right type. */
function keepAnalysis(a: Rec): Rec {
  const out: Rec = {};
  for (const [key, type] of Object.entries(KEPT_ANALYSIS)) {
    if (has(a, key) && typeof a[key] === type) out[key] = a[key];
  }
  return out;
}

function trim(call: Rec): Rec {
  const out: Rec = {};
  for (const key of KEPT_SCALARS) {
    if (has(call, key) && isPlain(call[key])) out[key] = call[key];
  }
  if (has(call, "call_analysis") && isRec(call.call_analysis)) out.call_analysis = keepAnalysis(call.call_analysis);
  const source = TRANSCRIPTS.find((key) => has(call, key) && Array.isArray(call[key]) && call[key].length > 0);
  if (source) out[source] = (call[source] as unknown[]).map(keepUtterance);
  return out;
}

/** The record a pin stores. Anything that is not a call record, or cannot be copied, gives an empty one. */
export function minimizeRecord(raw: unknown): unknown {
  try {
    return trim(unwrap(raw));
  } catch {
    // structuredClone throws a RangeError on input nested too deeply, and other errors on what is not plain data.
    return {};
  }
}
