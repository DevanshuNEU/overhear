// The engine's own words: the detail a gap carries, and the sentences a finding says (spec 6.8). Code values map to
// these and nothing else writes them. Contract titles are not here: they come from CONTRACT_TITLE in
// @/report/labels, so a renamed title flows into every stored finding.
import { CONTRACT_TITLE } from "@/report/labels";
import type { ChangeKind, ContractId, Evidence, Gap, GapCode } from "@/report/schema";
import { isPlaceholder } from "./placeholder";

/** The detail an evidence gap carries, by code. Codes are added as the engine learns to raise them. */
export const GAP_DETAIL = {
  missing_tool_transcript: "Retell kept the conversation but not its tool calls, so what the system did and when can't be checked.",
} satisfies Partial<Record<GapCode, string>>;

/** What a finding says when a gap makes it unverified: what is missing, and what would make it checkable. */
export interface GapText {
  missing: string;
  fix: string;
}

/**
 * The words for each gap code. {tool}, {field} and {kind} are filled in by fillText. The fix is its own field: it
 * joins a stored sentence only through withFix, and the screen's own next steps live in @/report/labels.
 */
export const GAP_TEXT: Record<GapCode, GapText> = {
  missing_tool_transcript: {
    missing: "the call record has no tool calls",
    fix: "Export the call with its tool transcript, or add a backend log with --actions.",
  },
  unlinked_backend_action: {
    missing: "a backend action couldn't be matched to a tool call",
    fix: "Log tool_call_id with each action.",
  },
  ambiguous_link: {
    missing: "a backend action matched more than one tool call",
    fix: "Log tool_call_id with each action.",
  },
  turn_index_out_of_range: {
    missing: "a backend action points past the last turn",
    fix: "Check how turn_index is counted.",
  },
  unknown_success: {
    missing: "the {tool} result doesn't say whether it worked",
    fix: "Map a success path for {tool} in the policy.",
  },
  evidence_conflict: {
    missing: "the backend log and the call record disagree about {tool}",
    fix: "Check which one is right; Overhear won't pick.",
  },
  unresolved_committed_detail: {
    missing: "the {field} of the {kind} isn't in the call",
    fix: "Add a lookup to the policy, or a backend log with --actions.",
  },
  llm_code_disagreement: {
    missing: "the model and the code read this turn differently",
    fix: "Read the turn and decide.",
  },
};

/** The unverified cases that are not gaps. order_unknown is this engine's own: the gap table has no row for it. */
export const REASONS = {
  no_claim: { missing: "the agent never confirmed the {kind}", fix: "None needed if that was intended." },
  field_not_spoken: { missing: "the agent didn't say the {field}", fix: "None needed if that was intended." },
  no_request: { missing: "no caller request was found", fix: "Check the post-call analysis fields in the policy." },
  llm_failed: { missing: "the model's reply couldn't be read", fix: "Run again, or check the model setting." },
  order_unknown: { missing: "the call record doesn't say what happened first", fix: "Export the call with its tool transcript, which keeps the order." },
} satisfies Record<string, GapText>;

/** Words for the kinds of change, in the sentences. */
export const KIND_WORDS: Record<ChangeKind, string> = {
  book: "booking",
  cancel: "cancellation",
  reschedule: "reschedule",
  update: "update",
};

/** The word for a kind of change, or "change" when there is no kind. */
export function kindWord(kind?: ChangeKind): string {
  return kind ? KIND_WORDS[kind] : "change";
}

/** What fills the {tool}, {field} and {kind} slots of a GAP_TEXT or REASONS string. */
export interface TextSlots {
  tool?: string;
  field?: string;
  kind?: ChangeKind;
}

/** A string with its slots filled. A slot with no value reads "tool", "detail" or "change". */
export function fillText(text: string, slots: TextSlots = {}): string {
  return text
    .replaceAll("{tool}", slots.tool ?? "tool")
    .replaceAll("{field}", slots.field ?? "detail")
    .replaceAll("{kind}", kindWord(slots.kind));
}

/** The words for one gap, slots filled from the gap itself and then from what the caller knows (a default tool). */
export function describeGap(gap: Pick<Gap, "code" | "tool" | "field" | "kind">, fallback: TextSlots = {}): GapText {
  const slots: TextSlots = { tool: gap.tool ?? fallback.tool, field: gap.field ?? fallback.field, kind: gap.kind ?? fallback.kind };
  const text = GAP_TEXT[gap.code];
  return { missing: fillText(text.missing, slots), fix: fillText(text.fix, slots) };
}

// ---------- Findings (6.8) ----------

/**
 * Whether the stored sentence of an unverified finding ends with the fix. Decided by the product owner: no. Next
 * steps live in @/report/labels only. Set it to true and withFix appends the fix, then regenerate the goldens.
 */
export const STORE_FIX_CLAUSE: boolean = false;

/** The one place a fix joins a sentence: appended after a space when stored, else the sentence unchanged. */
export function withFix(sentence: string, fix: string, store: boolean = STORE_FIX_CLAUSE): string {
  return store && fix !== "" ? `${sentence} ${fix}` : sentence;
}

/** "Couldn't check {contract title}: {what's missing}." from one or more causes, with their fixes behind withFix. */
export function unverifiedText(contract: ContractId, causes: GapText[]): string {
  const missing = [...new Set(causes.map((c) => c.missing))].join("; ");
  const fix = [...new Set(causes.map((c) => c.fix))].join(" ");
  return withFix(`Couldn't check ${CONTRACT_TITLE[contract]}: ${missing}.`, fix);
}

/** A time inside the call as minutes and seconds: 142.6 becomes "2:22". */
function clock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * When something happened, for a sentence: a turn's start as m:ss, or "turn n" (its place among the call's turns,
 * from 1) when the record has no start time. A tool call, result or event takes the time of the last turn before
 * it; with no turn before it, the start of the call, 0:00.
 */
export function formatTime(seq: number, ev: Evidence): string {
  const turns = ev.items.filter((it) => it.kind === "turn");
  const at = ev.items.find((it) => it.seq === seq);
  const turn = at?.kind === "turn" ? at : turns.filter((t) => t.seq < seq).at(-1);
  if (!turn) return "0:00";
  if (turn.startSec !== null) return clock(turn.startSec);
  return `turn ${turns.indexOf(turn) + 1}`;
}

/** Why a promise is broken: the reason slot of the promise_backed template. */
export type PromiseReason =
  | { why: "not_attempted"; kind?: ChangeKind }
  | { why: "attempted_later"; kind?: ChangeKind }
  | { why: "failed"; kind?: ChangeKind; error: string }
  | { why: "unfinished"; kind?: ChangeKind };

/**
 * The error a failed result gives: its error field when that is readable text, else "no reason given". A redaction
 * placeholder is not a reason, and one closing period is dropped so the sentence does not end in two.
 */
export function errorReason(result: unknown): string {
  const error = typeof result === "object" && result !== null && !Array.isArray(result) ? (result as Record<string, unknown>).error : undefined;
  if (typeof error !== "string" || error.trim() === "" || isPlaceholder(error)) return "no reason given";
  return error.trim().replace(/\.$/, "");
}

/** `At {time} the agent said "{quote}".`: how every claim-based finding opens. */
function said(time: string, quote: string): string {
  return `At ${time} the agent said "${quote}".`;
}

/**
 * promise_backed, violated. attempted_later is for a claim made before the change was first tried: "No {kind} was
 * attempted before that", since the record does show one later. The other three are the 6.8 reasons word for word.
 */
export function promiseViolatedText(time: string, quote: string, reason: PromiseReason): string {
  const word = kindWord(reason.kind);
  const why =
    reason.why === "not_attempted"
      ? `No ${word} was attempted`
      : reason.why === "attempted_later"
        ? `No ${word} was attempted before that`
        : reason.why === "failed"
          ? `The ${word} failed: ${reason.error}`
          : `The ${word} hadn't finished yet`;
  return `${said(time, quote)} ${why}.`;
}

/** promise_backed, passed. Not in 6.8: the three sample calls are the contract for it. */
export function promisePassedText(time: string, quote: string, kind?: ChangeKind): string {
  return `${said(time, quote)} The ${kindWord(kind)} succeeded before that.`;
}

/** verified_before_change, violated. */
export function verifiedViolatedText(kind: ChangeKind | undefined, time: string, reason: "no_check" | "other_patient"): string {
  const why = reason === "no_check" ? "before any identity check" : "for a different patient than the one verified";
  return `The ${kindWord(kind)} at ${time} happened ${why}.`;
}

/** spoken_matches_committed, violated. */
export function spokenViolatedText(spoken: string, committed: string): string {
  return `The agent confirmed ${spoken}. What was committed is ${committed}.`;
}

/** spoken_matches_committed, passed. Not in 6.8: the samples are the contract for it. */
export function spokenPassedText(spoken: string): string {
  return `The agent confirmed ${spoken}. That is what was committed.`;
}

/** transfer_kept, violated: the agent said it was transferring and no transfer worked. */
export function transferViolatedText(time: string, reason: "not_attempted" | "failed"): string {
  const why = reason === "not_attempted" ? "No transfer was attempted" : "The transfer failed";
  return `At ${time} the agent said it was transferring the caller. ${why}.`;
}

/** transfer_kept, violated: the agent read a tool command out loud. */
export function toolSyntaxText(time: string, quote: string): string {
  return `At ${time} the agent read out a tool command: "${quote}".`;
}

/** committed_matches_request, violated. */
export function requestViolatedText(requested: string, committed: string): string {
  return `The caller asked for ${requested}. The agent committed ${committed}.`;
}

/** The detail of an unknown_success gap: a tool result that says neither way whether it worked. */
export function unknownSuccessDetail(tool: string): string {
  return `Neither the ${tool} result nor Retell says whether it worked, so anything that rests on it can't be checked.`;
}

/** The detail of an unknown_success gap where Retell says the call went through but the result reads like an error. */
export function unknownSuccessConflictDetail(tool: string): string {
  return `Retell says the ${tool} call went through, but its result reads like an error, so whether it worked can't be checked.`;
}

/** Why a committed detail has no value to compare: no lookup offered it, or the record has it scrubbed. */
export type UnresolvedWhy = "no_source" | "scrubbed";

/** One earlier lookup item that offered the changed slot: the lookup, the seq of its result, and what it said. */
export interface LookupCandidate {
  tool: string;
  seq: number;
  said: string;
}

/**
 * The detail of an unresolved_committed_detail gap for one field where earlier lookups offered the same slot with
 * different values, so none is picked. Each candidate is named with its lookup, result and value, oldest first.
 */
export function lookupsDisagreeDetail(field: string, candidates: LookupCandidate[]): string {
  const said = candidates.map((c) => `${c.tool} (result ${c.seq}) said ${c.said}`);
  return `Earlier lookups gave different values for the ${field} of this slot: ${said.join("; ")}.`;
}

/** The detail of an unresolved_committed_detail gap: one detail a change committed that can't be read back. */
export function unresolvedDetail(field: string, tool: string, why: UnresolvedWhy): string {
  if (why === "scrubbed") {
    return `The ${field} the ${tool} call committed is hidden by Retell's privacy setting, so it can't be compared with what the agent said.`;
  }
  return `The ${field} the ${tool} call committed can't be found in the record, so it can't be compared with what the agent said.`;
}
