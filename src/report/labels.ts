// The only mapping from code values to words people read (spec section 5 and 6.8).
// The engine writes `headline` with headlineFor, and the dashboard shows the stored
// string, so both sides say the same thing. Pure data and functions, no Node APIs.
import type { ContractId, Note, ReviewReasonKind, Result, Verdict } from "./schema";

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
