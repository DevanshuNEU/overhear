// The only mapping from code values to words people read (spec section 5 and 6.8).
// The engine writes `headline` with headlineFor, and the dashboard shows the stored
// string, so both sides say the same thing. Pure data and functions, no Node APIs.
import type { ContractId, FieldCheck, GapCode, Note, Platform, ReviewReasonKind, Result, Verdict } from "./schema";

export const RESULT_LABEL: Record<Result, string> = {
  violated: "Broken",
  passed: "Kept",
  unverified: "Couldn't check",
  not_applicable: "Doesn't apply",
  not_run: "Not checked",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  failed: "Failed",
  needs_review: "Needs review",
  passed: "Passed",
};

export const CONTRACT_TITLE: Record<ContractId, string> = {
  promise_backed: "promises backed by the system",
  verified_before_change: "identity checked before changes",
  spoken_matches_committed: "spoken details match the booking",
  transfer_kept: "promised transfers happen",
  committed_matches_request: "booking matches the request",
};

/** The sentence a note adds to a passed call. */
export const NOTE_LINE: Record<Note, string> = {
  no_promises_made: "The agent made no promises.",
  request_not_checked: "The caller's request wasn't checked.",
};

/** The line a needs-review call shows for one reason. Listed in the order the headline prefers them. */
export const REASON_LINE: Record<ReviewReasonKind, string> = {
  unverified_result: "Something couldn't be checked. See what's missing.",
  deferral: "The agent deferred the caller's request instead of completing it.",
  unanswered_request: "The caller asked for something the agent neither did nor refused.",
};

const REASON_ORDER: ReviewReasonKind[] = ["unverified_result", "deferral", "unanswered_request"];

/** The one line a call shows for its verdict, notes and reasons, word for word from spec 6.8. */
export function headlineFor(verdict: Verdict, notes: Note[], reasons: { kind: ReviewReasonKind }[]): string {
  if (verdict === "failed") return "The call broke a rule, and the call record shows it.";
  if (verdict === "needs_review") {
    const first = REASON_ORDER.find((k) => reasons.some((r) => r.kind === k));
    return first ? REASON_LINE[first] : REASON_LINE.unverified_result;
  }
  const lead = notes.includes("no_promises_made") ? "Passed. " + NOTE_LINE.no_promises_made : "Every promise that applied was kept.";
  return notes.includes("request_not_checked") ? `${lead} ${NOTE_LINE.request_not_checked}` : lead;
}

// ---------- The call detail screen ----------

export const PLATFORM_LABEL: Record<Platform, string> = {
  retell: "Retell",
  livekit: "LiveKit",
};

export const TIER_LABEL: Record<1 | 2, string> = {
  1: "Call record only",
  2: "Call record and backend log",
};

export const FACT_LABEL = {
  platform: "Platform",
  length: "Length",
  started: "Started",
  evidence: "Evidence",
  rules: "Rules",
};

export const HEADING = {
  rows: "Said and did",
  reasons: "Why it needs review",
  gaps: "What we couldn't check",
  otherRules: "Other rules",
  timeline: "The call",
};

export const KEY_FACTS_LABEL = "Key facts";

/** What a gap in the evidence is called. The engine's own detail says which call and which field. */
export const GAP_LABEL: Record<GapCode, string> = {
  missing_tool_transcript: "Tool calls are missing from the transcript",
  unlinked_backend_action: "A backend action matches no tool call",
  ambiguous_link: "A backend action matches more than one tool call",
  turn_index_out_of_range: "A backend action points outside the transcript",
  unknown_success: "A tool result gave no success signal",
  evidence_conflict: "The records disagree",
  unresolved_committed_detail: "A committed detail couldn't be resolved",
  llm_code_disagreement: "The model and the rules disagree on a claim",
};

/** The name a review reason gets as a tag on the timeline. */
export const REASON_TAG: Record<ReviewReasonKind, string> = {
  unverified_result: "Couldn't check",
  deferral: "Deferral",
  unanswered_request: "Unanswered request",
};

/** The Evidence fact: the source, and how many gaps it has when it has any. */
export function evidenceFact(tier: 1 | 2, gapCount: number): string {
  if (gapCount === 0) return TIER_LABEL[tier];
  return `${TIER_LABEL[tier]}, ${gapCount} ${gapCount === 1 ? "gap" : "gaps"}`;
}

/** Said after the sentence of a rule that broke more than once. */
export function repeatedLine(times: number): string {
  return times === 2 ? "This happened twice." : `This happened ${times} times.`;
}

/** Said after a review reason when several rules could not be checked for it. */
export function uncheckedCountLine(rules: number): string {
  return `${rules} rules couldn't be checked.`;
}

/** The one line a rule gives when it could not be checked: the reason is said once, in the section it points to. */
export const SEE_GAPS = "See what we couldn't check.";

/** Names the rules a gap blocks. */
export function blockedLine(titles: string[]): string {
  return `Rules it blocks: ${titles.join(", ")}.`;
}

/** Opens the whole of a turn when the Said lane shows only the claim and the sentences beside it. */
export const WHOLE_TURN = "Whole turn";

/** "a", "a and b", "a, b and c". */
function listed(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** ", at 2:01 and 2:22", or nothing when a time is missing for any of them. */
function atTimes(times: string[]): string {
  return times.length === 0 ? "" : `, at ${listed(times)}`;
}

const timesOf = (n: number) => (n === 2 ? "twice" : `${n} times`);

/**
 * The lead sentence for a rule that broke more than once: a template per rule, filled only with the count and the
 * times of the findings. It states nothing the findings do not. `times` is empty when any time is unknown.
 * A rule with no template falls back to the first finding's sentence and a count (see answer.ts).
 */
export const LEAD_TEMPLATES: Partial<Record<ContractId, (count: number, times: string[]) => string>> = {
  promise_backed: (n, times) => `The agent made ${n} promises the system had not backed${atTimes(times)}.`,
  verified_before_change: (n) => `${n} changes were made before the caller's identity was checked.`,
  spoken_matches_committed: (n, times) => `The agent confirmed details that differed from the booking ${n} times${atTimes(times)}.`,
  transfer_kept: (n, times) => `The agent said ${timesOf(n)} that it was transferring the caller${atTimes(times)}. No transfer was attempted.`,
  committed_matches_request: (n) => `${n} bookings differed from what the caller asked for.`,
};

export const LOADING_LABEL = "Loading the call";

export const NOT_FOUND = {
  title: "No report for this call.",
  detail: (callId: string | null) => (callId ? `Overhear holds no report with the ID ${callId}.` : "Overhear holds no report with this ID."),
  next: "Check the ID in the link, then open the call again.",
};

export const UNREADABLE = {
  title: "This report can't be read.",
  detail: (callId: string | null) =>
    callId ? `The report for ${callId} doesn't match the report format, so Overhear won't show it.` : "This report doesn't match the report format, so Overhear won't show it.",
  next: "Regenerate the report, then reload this page.",
  problems: "What failed",
  count: (total: number, shown: number) => `${total} problems, first ${shown} shown`,
};

/** The three lanes of a finding: the caller's request, the agent's words, what the system did. */
export const LANE_LABEL = {
  asked: "Asked",
  said: "Said",
  did: "Did",
};

/** Shown in the Did lane when the record gives no more specific proof that the system did nothing. */
export const NOTHING_DID = "No matching action in the call record.";

/** The proof that nothing was done, built only from what the record holds. `clock` is when the agent made the claim. */
export function noTransferAfter(clock: string | null): string {
  return `No transfer tool was called after ${clock ?? "the claim"}.`;
}

export function noChangeBefore(clock: string | null): string {
  return `No tool that changes a booking was called before ${clock ?? "the claim"}.`;
}

export function toolsCalledLine(names: string[]): string {
  return names.length === 0 ? "No tools were called in this call." : `Tools called in this call: ${names.join(", ")}.`;
}

/** A tool call that got no result back. */
export function toolNoResultLine(name: string): string {
  return `${name} was called, no result came back`;
}

export const FIELD_STATUS_LABEL: Record<FieldCheck["status"], string> = {
  match: "Matches",
  differs: "Differs",
  not_spoken: "Not spoken",
  unresolved: "Couldn't resolve",
};

export const FIELD_COLUMN_LABEL = {
  field: "Detail",
  compared: "Compared",
  committed: "Committed",
  status: "Result",
};

export const FIELD_FROM_LABEL: Record<FieldCheck["from"], string> = {
  spoken: "Spoken",
  requested: "Requested",
};

/** Shown in the Committed column when the engine could not find the value the system committed. */
export const NOTHING_COMMITTED = "Couldn't find";

/** Shown in the Compared column when a check holds no values. */
export const FIELD_NONE_LABEL: Record<FieldCheck["from"], string> = {
  spoken: "Nothing spoken",
  requested: "Nothing requested",
};

/** One compared value as a line: "Spoken: Dr. Nair". */
export function comparedLine(from: FieldCheck["from"], values: string[]): string {
  if (values.length === 0) return FIELD_NONE_LABEL[from];
  return `${FIELD_FROM_LABEL[from]}: ${values.join(", ")}`;
}

export const SPEAKER_LABEL = {
  agent: "Agent",
  caller: "Caller",
};

/** Tells findings of one contract apart: "Transfers kept, 1 of 2". */
export function numberedLabel(label: string, n: number, total: number): string {
  return `${label}, ${n} of ${total}`;
}

/** Said after a timeline tag's name, so the result never rests on colour alone. */
export function tagResultSuffix(result: Result): string {
  return `, ${RESULT_LABEL[result]}`;
}

/** Said above the timeline when the engine could not take the platform's own order for granted. */
export const ORDER_NOTE: Record<"timestamps" | "none", string> = {
  timestamps: "The platform gave no sequence, so these items are ordered by their timestamps.",
  none: "The order of these items couldn't be established. They are listed as received.",
};

/** The link from a finding to the first item it cites in the call timeline. */
export const SHOW_IN_CALL = "Show in the call";

export const COPY_ID_LABEL = "Copy call ID";
export const COPIED_LABEL = "Copied";
export const RAW_DETAIL_LABEL = "Raw detail";
/** Shown inside the raw detail when the record cannot be turned into text (a value JSON cannot hold, or a loop). */
export const RAW_UNAVAILABLE = "The raw record couldn't be shown.";
export const BACKEND_LOG_TAG = "Backend log";
export const SKIP_TO_CONTENT_LABEL = "Skip to the call";
export const PAGE_NAME = "Overhear";

/** Starts a sentence or a heading with a capital. The wording tables keep titles lower case so they can sit inside a sentence. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A call's length in words people say: "2 min 41 s". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** The Rules fact: how many contracts broke, couldn't be checked or held. Contracts that did not apply or did not run are left out. */
export function rulesSummary(results: { result: Result }[]): string {
  const count = (r: Result) => results.filter((x) => x.result === r).length;
  const parts = [
    [count("violated"), "broken"],
    [count("unverified"), "couldn't check"],
    [count("passed"), "kept"],
  ].filter(([n]) => (n as number) > 0);
  return parts.length ? parts.map(([n, word]) => `${n} ${word}`).join(", ") : "None applied";
}

/** What a tool call looks like in the Did lane. The tool's name is the engineer's own, so it stays as written. */
export function toolCallLine(name: string): string {
  return `Called ${name}`;
}

export function toolResultLine(name: string, ok: boolean | null): string {
  if (ok === null) return `${name} gave no success signal`;
  return ok ? `${name} succeeded` : `${name} failed`;
}

export function backendActionLine(tool: string, ok: boolean): string {
  return ok ? `${tool} recorded as succeeded` : `${tool} recorded as failed`;
}

export function eventLine(type: string): string {
  return `Event: ${type}`;
}
