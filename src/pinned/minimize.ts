// Trims a Retell call record to what a pin keeps on disk. This is an allowlist, not a blocklist: a field is dropped
// unless it is named here, so a field Retell adds later is dropped too. What stays is what the engine needs to read
// the call again: ids, status, timing, disconnection, three analysis flags and the one transcript the adapter
// reads. Left out on purpose: the access token, every recording, log and signed link, phone numbers, SIP headers,
// metadata and dynamic variables, the summary, cost and latency. Tool arguments and results are never altered,
// because the verdict depends on them.
//
// Pure: no clock, no disk, no network. The input is never changed; the answer shares nothing with it.

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

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isPlain = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
const has = (o: Rec, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** The record itself, out of a webhook or custom-function body when it is wrapped in one (as the adapter does). */
function unwrap(raw: unknown): Rec {
  if (!isRec(raw)) return {};
  return !has(raw, "call_id") && isRec(raw.call) ? raw.call : raw;
}

/** A copy of one utterance. An SMS keeps its words but loses the link of each attachment; anything else stays whole. */
function keepUtterance(u: unknown): unknown {
  const copy = structuredClone(u);
  if (isRec(copy) && copy.role === "sms" && Array.isArray(copy.multimedia)) {
    copy.multimedia = copy.multimedia.map((m: unknown) => (isRec(m) ? Object.fromEntries(Object.entries(m).filter(([k]) => k !== "url")) : m));
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

/** The record a pin stores. Anything that is not a call record gives an empty one, so nothing leaks through. */
export function minimizeRecord(raw: unknown): unknown {
  const call = unwrap(raw);
  const out: Rec = {};
  for (const key of KEPT_SCALARS) {
    if (has(call, key) && isPlain(call[key])) out[key] = call[key];
  }
  if (isRec(call.call_analysis)) out.call_analysis = keepAnalysis(call.call_analysis);
  const source = TRANSCRIPTS.find((key) => Array.isArray(call[key]) && call[key].length > 0);
  if (source) out[source] = (call[source] as unknown[]).map(keepUtterance);
  return out;
}
