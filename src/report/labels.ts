// The only mapping from code values to words people read (spec section 5 and 6.8).
// The engine writes `headline` with headlineFor, and the dashboard shows the stored
// string, so both sides say the same thing. Pure data and functions, no Node APIs.
import type { ContractId, ExperienceCheckId, FieldCheck, GapCode, Note, Platform, ReviewReasonKind, Result, Verdict } from "./schema";

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
  nothing_done: "Nothing done",
};

export const CONTRACT_TITLE: Record<ContractId, string> = {
  promise_backed: "promises backed by the system",
  verified_before_change: "identity checked before changes",
  spoken_matches_committed: "spoken details match the booking",
  transfer_kept: "promised transfers happen",
  committed_matches_request: "booking matches the request",
};

/** The call experience checks, named the way CONTRACT_TITLE names a contract: lowercase, to sit in a sentence. */
export const EXPERIENCE_TITLE: Record<ExperienceCheckId, string> = {
  agent_ends_call: "how the call ends",
  error_handled: "how errors are handled",
  spoken_format: "how dates and times are read",
};

/** The line under the verdict that says how the call sounded to the caller. Never changes the verdict. */
export const experienceLine = (problems: number): string => (problems === 0 ? "Call experience: no problems found" : `Call experience: ${problems} ${problems === 1 ? "problem" : "problems"}`);

/** Which call experience checks ran, so "no problems" says what it rests on. Only checks that ran are named. */
export function experienceChecked(ran: ExperienceCheckId[]): string {
  const titles = ran.map((id) => EXPERIENCE_TITLE[id]);
  const list = titles.length > 1 ? `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}` : titles.join("");
  return `Checked: ${list}.`;
}

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
  if (verdict === "nothing_done") return "Nothing done. The caller said almost nothing, and the agent took no action.";
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

/** One line for the rules that share a result: "5 rules didn't apply", "1 rule not checked". */
export function ruleCountLine(result: "not_applicable" | "not_run", count: number): string {
  const rules = count === 1 ? "1 rule" : `${count} rules`;
  return result === "not_applicable" ? `${rules} didn't apply` : `${rules} not checked`;
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
 * times of the findings. It states nothing the findings do not, and holds for every kind of change (a booking, a
 * cancel, a reschedule, an update) whether the change went through or only was tried. `times` is empty when any
 * time is unknown. `proven` is true when the record proves the absence every finding rests on (absence.ts); when it
 * does not, an absence is said as what Overhear found, never as what happened.
 * A rule with no template falls back to the first finding's sentence and a count (see answer.ts).
 */
export const LEAD_TEMPLATES: Partial<Record<ContractId, (count: number, times: string[], proven: boolean) => string>> = {
  promise_backed: (n, times) => `The agent made ${n} promises the system had not backed${atTimes(times)}.`,
  verified_before_change: (n) => `A tool that changes a booking was called ${timesOf(n)} without a successful identity check first.`,
  spoken_matches_committed: (n, times) => `The agent confirmed details that differed from what was committed ${timesOf(n)}${atTimes(times)}.`,
  transfer_kept: (n, times, proven) =>
    `The agent said ${timesOf(n)} that it was transferring the caller${atTimes(times)}. ` +
    (proven ? "No transfer was attempted." : `Overhear found no transfer attempt after ${n === 2 ? "either" : "any"} of them.`),
  committed_matches_request: (n) => `What was committed differed from the caller's request ${timesOf(n)}, as Overhear read that request.`,
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

/** The status of an unresolved row that still has a committed value: it names the readings the time could have. */
export const ZONE_UNCLEAR_LABEL = "Time zone unclear";

/** The words for a row's status. An unresolved row with a committed value is a time zone doubt, not a missing value. */
export function fieldStatusLabel(f: Pick<FieldCheck, "status" | "committed">): string {
  return f.status === "unresolved" && f.committed !== null ? ZONE_UNCLEAR_LABEL : FIELD_STATUS_LABEL[f.status];
}

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
/** The link above a call screen. Local mode goes to the call list; a hosted copy has no list, so it goes to the demo. */
export const BACK_LABEL = { local: "All calls", hosted: "Back to the demo" } as const;
/** The tab's title in place of an address that does not look like a call ID, so a crafted address is never repeated. */
export const REPORT_TITLE = "Call report";

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

// ---------- What to do next ----------

export const NEXT_HEADING = "What to do next";

/** One numbered step: a short lead in bold, then the sentence that says what to do. */
export type NextStep = { lead: string; text: string };

const FIND_THE_PROMISE = "Find the promise.";
const READ_THE_PROMISE = "Read the marked words under Said, then the tool calls under Did.";
const CHECK_THE_TOOL_CALL: NextStep = {
  lead: "Check the tool call.",
  text: "If a call was made, open its raw detail to see what was sent and what came back. If none was made, check that the agent's prompt tells it to call the tool before it speaks.",
};
const CAN_TRANSFER = "Check the agent can transfer.";
const LOOK_FOR_TRANSFER = "Look in the agent's setup for a transfer tool.";
const TRANSFER_PROMPT: NextStep = { lead: "Check the agent's prompt.", text: "It should call the transfer tool before it says it is transferring, or not offer transfers at all." };

/**
 * What to do about a rule that broke. Each step is a check the evidence supports, not a fix the evidence does
 * not know. A rule that held, could not be checked or did not apply has no steps here. A step that names what the
 * system did not do says it as what Overhear found: PROVEN_NEXT_STEPS says it as what the record shows, and is
 * used only when the record proves it.
 */
export const NEXT_STEPS: Record<ContractId, NextStep[]> = {
  promise_backed: [{ lead: FIND_THE_PROMISE, text: `${READ_THE_PROMISE} Overhear found no successful call that backs the promise.` }, CHECK_THE_TOOL_CALL],
  verified_before_change: [
    { lead: "Check the identity check.", text: "Under Did, see whether an identity check was made and succeeded before the change. A change with no successful check before it is the break." },
    { lead: "Check the agent's prompt.", text: "Check that it tells the agent to wait for the identity check to succeed before it calls a tool that changes a booking." },
  ],
  spoken_matches_committed: [
    { lead: "Compare the two values.", text: "Where there is a table, it puts what the agent said next to what was committed, and the row marked Differs is the one to chase." },
    { lead: "Find where the agent got it.", text: "Check whether the agent spoke the caller's words or the tool result that held the value, then whether it passed that same value to the booking tool." },
  ],
  transfer_kept: [
    {
      lead: CAN_TRANSFER,
      text: `${LOOK_FOR_TRANSFER} Overhear found no transfer after the claim, but the record can't prove there was none, so check what the call did after it.`,
    },
    TRANSFER_PROMPT,
  ],
  committed_matches_request: [
    { lead: "Compare with the request.", text: "Where there is a table, it puts what the engine read as the caller's request next to what was committed, and the row marked Differs is the one to chase." },
    { lead: "Check the engine's reading.", text: "Check the transcript for what the caller actually asked. If they changed their mind, check the agent took the last request and not the first." },
  ],
};

/**
 * The steps of a rule whose every broken finding the record proves (absence.ts): the same checks, with the
 * absence said as what the record shows.
 */
export const PROVEN_NEXT_STEPS: Partial<Record<ContractId, NextStep[]>> = {
  promise_backed: [{ lead: FIND_THE_PROMISE, text: `${READ_THE_PROMISE} The record shows no successful call that backs the promise.` }, CHECK_THE_TOOL_CALL],
  transfer_kept: [{ lead: CAN_TRANSFER, text: `${LOOK_FOR_TRANSFER} The record shows no transfer tool was called after the claim.` }, TRANSFER_PROMPT],
};

/**
 * What to do about a gap, by its code. Empty for now: the engine's finding sentence may already end with what
 * would make the result checkable, and a step here would say it twice. Adding a gap's steps is only a matter of
 * adding its entry here; the column shows them after the steps for broken rules.
 */
export const GAP_NEXT_STEPS: Partial<Record<GapCode, NextStep[]>> = {};

/**
 * What to do about a review reason, by its kind. Only reasons that name something of their own have steps: a rule
 * that could not be checked is covered by its gap. A deferral has none yet.
 */
export const REASON_NEXT_STEPS: Partial<Record<Exclude<ReviewReasonKind, "unverified_result">, NextStep[]>> = {
  unanswered_request: [
    {
      lead: "Check what happened after the request.",
      text: "If a tool returned an error, open that tool's own logs for this call's time. The call record shows only that it returned an error.",
    },
  ],
};

export const COPY_ID_FOR_LOGS = "Copy call ID for your logs";

// ---------- A call with no report ----------

/** Why a call has no report: there is no transcript to check, and the reason says why. */
export const NO_CONTENT_REASONS = ["storage_stripped", "never_connected", "no_transcript"] as const;
export type NoContentReason = (typeof NO_CONTENT_REASONS)[number];

/** The sentence a call shows in place of a verdict when it has no report. */
export const NO_CONTENT_LINE: Record<NoContentReason, string> = {
  storage_stripped: "Retell didn't keep this call's transcript, because the agent stores only basic call details.",
  never_connected: "The call never connected, so there's no conversation to check.",
  no_transcript: "Retell returned no transcript for this call.",
};

/** What the engine says about a record it cannot read as a Retell call, and what to pass instead. */
export const NOT_A_RETELL_CALL = {
  message: "This isn't a Retell call record: it has no call_id.",
  fix: "Pass the body of Retell's get-call response, or a webhook body that holds it under call.",
};

// ---------- Keep as a test (local mode) ----------
// The words of the control on a call report. The messages for a refusal come from the server (PIN_MESSAGE in src/pull/labels.ts)
// and are shown as they arrive.

/** The longest note a pin takes. A test keeps it equal to PIN_NOTE_MAX in the engine, which a screen must not import. */
export const KEEP_NOTE_MAX = 280;

export const KEEP_WORDS = {
  open: "Keep as a test",
  heading: "Keep this call as a test",
  intro: "Overhear saves this call and what it said about it. Run npm run check:pinned to see whether it still says the same.",
  verdictLabel: "Verdict",
  alwaysKept: "Always kept",
  rulesHeading: "Rules to keep",
  experienceHeading: "Call experience to keep",
  problem: "Problem",
  noProblem: "No problem",
  noteLabel: "Note (optional)",
  noteHint: "One line for your team.",
  noteCount: (used: number, max: number) => `${used} of ${max}`,
  /** The first-pin warning, word for word from the pin design. */
  firstPin:
    "This saves the call’s transcript and tool data on this computer, in ~/.overhear/pinned. It can hold names, dates of birth and health details. Nothing is sent anywhere. Recording links, the caller’s number and your API key are left out. You can delete it any time.",
  keep: "Keep call",
  keeping: "Keeping",
  cancel: "Cancel",
  kept: "Kept as a test",
  keptWhere: "Saved on this computer in ~/.overhear/pinned.",
  remove: "Remove",
  removing: "Removing",
  reload: "Open this call again",
  unreachable: "Couldn’t reach Overhear on this computer. Check that it is still running, then try again.",
} as const;

// ---------- Spoken numbers in the transcript ----------

/** The switch above the transcript. Speech to text writes numbers as words; the screen shows digits, and this shows the exact words. */
export const NUMBERS_SWITCH = { toExact: "Show exact words", toDigits: "Show numbers as digits" } as const;
