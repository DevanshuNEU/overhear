// The only mapping from code values to words people read (spec section 5 and 6.8).
// The engine writes `headline` with headlineFor, and the dashboard shows the stored
// string, so both sides say the same thing. Pure data and functions, no Node APIs.
import type { ContractId, FieldCheck, Note, Platform, ReviewReasonKind, Result, Verdict } from "./schema";

export const RESULT_LABEL: Record<Result, string> = {
  violated: "Violated",
  passed: "Passed",
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
  transfer_kept: "transfers kept",
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
  otherRules: "Other rules",
};

export const KEY_FACTS_LABEL = "Key facts";

/** The three lanes of a finding: the caller's request, the agent's words, what the system did. */
export const LANE_LABEL = {
  asked: "Asked",
  said: "Said",
  did: "Did",
};

/** Shown in the Did lane when a finding rests on nothing the system did. */
export const NOTHING_DID = "Nothing in the call record.";

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

export const COPY_ID_LABEL = "Copy call ID";
export const COPIED_LABEL = "Copied";
export const RAW_DETAIL_LABEL = "Raw detail";
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
    [count("unverified"), "couldn't be checked"],
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
