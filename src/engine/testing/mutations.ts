// The mutation suite (eval track E3): each mutation is a small, named, deterministic edit of one of the three
// sample records, with the verdict and per-contract results the engine must give the edited call. Test-only.
//
// The product's first rule is that a call is never called passed or failed on evidence that does not prove it. A
// mutation turns that rule into a test: break a known call one way (drop the booking, flip its result, change the
// spoken time) and check the engine says what a careful reader would. Mutations are code, not new data: every one
// starts from a sample record (the same scrubbed demo calls and fictional names) and the edit is the whole difference.
//
// The expectations are written from the rules, never copied from what the engine returned. A mutation the engine
// gets wrong is not made to pass: it goes in KNOWN_FAILURES with one line saying why, its case is written unlocked,
// and the lead files an issue. `npm run eval:engine -- --write-mutation-cases` writes the cases to eval/engine/cases/.
import type { ContractId, GapCode, Result, Verdict } from "@/report/schema";
import { CASE_SCHEMA_VERSION, type EvalCase } from "../eval/case";
import { sampleCases } from "./sample-cases";

type Rec = Record<string, unknown>;

/** When the mutations were written as cases. Fixed, so regenerating the files changes nothing. */
export const MUTATION_LABEL_DATE = "2026-11-07";

const FAILED = "sample-failed";
const PASSED = "sample-passed";
const NEEDS_REVIEW = "sample-needs-review";

export interface Mutation {
  /** The case id, "mut-" and lowercase words: what was broken. */
  id: string;
  /** The sample it is made from. */
  parent: typeof FAILED | typeof PASSED | typeof NEEDS_REVIEW;
  /** What was changed and why the expected result follows, in a sentence or two. */
  note: string;
  /** The edit. It gets a deep copy of the parent's record and returns the mutated record. */
  edit: (record: Rec) => Rec;
  /** The time zone the call is read in, when it matters. */
  tz?: string;
  expect: {
    verdict: Verdict;
    promise_backed: Result;
    spoken_matches_committed: Result;
    transfer_kept: Result;
  };
  /** Gap codes the report's evidence must list. The meta test uses them to see which codes the suite can produce. */
  gaps?: GapCode[];
  /** A contract's finding must cite the agent turn that holds this text (said, by its seq in the mutated record). */
  cites?: { contract: ContractId; turn: string }[];
}

// ---------- Editing helpers ----------

const TRANSCRIPT = "transcript_with_tool_calls";

/** The utterance list of a record. Throws when there is none, so a typo in an edit fails loudly. */
function utterances(record: Rec): Rec[] {
  const list = record[TRANSCRIPT];
  if (!Array.isArray(list)) throw new Error(`the record has no ${TRANSCRIPT}`);
  return list as Rec[];
}

/** The index of the one agent or caller turn whose text contains the snippet. Throws on none or on several. */
function turnIndex(record: Rec, snippet: string): number {
  const hits = utterances(record).flatMap((u, i) => ((u.role === "agent" || u.role === "user") && typeof u.content === "string" && u.content.includes(snippet) ? [i] : []));
  if (hits.length !== 1) throw new Error(`expected one turn containing "${snippet}", found ${hits.length}`);
  return hits[0];
}

/** The index of the tool call or result with this tool_call_id and role. */
function toolIndex(record: Rec, id: string, role: "tool_call_invocation" | "tool_call_result"): number {
  const i = utterances(record).findIndex((u) => u.tool_call_id === id && u.role === role);
  if (i < 0) throw new Error(`no ${role} with id ${id}`);
  return i;
}

/** Changes the first occurrence of `from` to `to` inside the one turn that contains `inTurn`. */
function say(record: Rec, inTurn: string, from: string, to: string): Rec {
  const turn = utterances(record)[turnIndex(record, inTurn)];
  const text = turn.content as string;
  if (!text.includes(from)) throw new Error(`the turn does not contain "${from}"`);
  turn.content = text.replace(from, to);
  return record;
}

/** Adds a turn at the end of the call. */
function appendTurn(record: Rec, role: "agent" | "user", content: string): Rec {
  utterances(record).push({ role, content, words: [] });
  return record;
}

/** Removes a tool call and its result. */
function dropTool(record: Rec, id: string): Rec {
  record[TRANSCRIPT] = utterances(record).filter((u) => u.tool_call_id !== id);
  return record;
}

/** Renames a tool, in every call of it. */
function renameTool(record: Rec, from: string, to: string): Rec {
  for (const u of utterances(record)) if (u.role === "tool_call_invocation" && u.name === from) u.name = to;
  return record;
}

/** Sets what a tool's result says: its content, and the platform's successful flag (undefined removes the flag). */
function setResult(record: Rec, id: string, content: unknown, successful: boolean | undefined): Rec {
  const result = utterances(record)[toolIndex(record, id, "tool_call_result")];
  result.content = typeof content === "string" ? content : JSON.stringify(content);
  if (successful === undefined) delete result.successful;
  else result.successful = successful;
  return record;
}

/** Moves a tool call and its result to just after the turn that contains the snippet. */
function moveToolAfterTurn(record: Rec, id: string, snippet: string): Rec {
  const list = utterances(record);
  const moved = list.filter((u) => u.tool_call_id === id);
  const rest = list.filter((u) => u.tool_call_id !== id);
  const at = rest.findIndex((u) => u === list[turnIndex(record, snippet)]);
  record[TRANSCRIPT] = [...rest.slice(0, at + 1), ...moved, ...rest.slice(at + 1)];
  return record;
}

/** Inserts a tool call (and optionally its result) just after the turn that contains the snippet. */
function addToolAfterTurn(record: Rec, snippet: string, call: Rec, result?: Rec): Rec {
  const list = utterances(record);
  const at = turnIndex(record, snippet);
  list.splice(at + 1, 0, call, ...(result ? [result] : []));
  return record;
}

/** Inserts a tool call and its result just before the turn that contains the snippet. */
function addToolBeforeTurn(record: Rec, snippet: string, call: Rec, result: Rec): Rec {
  utterances(record).splice(turnIndex(record, snippet), 0, call, result);
  return record;
}

/** Inserts an utterance of any role (a platform event such as transfer_target) just after the turn with the snippet. */
function addEventAfterTurn(record: Rec, snippet: string, event: Rec): Rec {
  utterances(record).splice(turnIndex(record, snippet) + 1, 0, event);
  return record;
}

/** Replaces every redaction-free provider name in the lookups' items with a placeholder, as Retell does when it scrubs. */
function scrubSlotField(record: Rec, field: "providerName" | "startsAt", placeholder: string): Rec {
  for (const u of utterances(record)) {
    if (u.role !== "tool_call_result" || typeof u.content !== "string") continue;
    const body: unknown = JSON.parse(u.content);
    if (typeof body !== "object" || body === null || !Array.isArray((body as Rec).slots)) continue;
    for (const slot of (body as Rec).slots as Rec[]) slot[field] = placeholder;
    u.content = JSON.stringify(body);
  }
  return record;
}

/** The record as the platform would send it with no tool items: turns only, under transcript_object. */
function turnsOnly(record: Rec): Rec {
  const turns = utterances(record).filter((u) => u.role === "agent" || u.role === "user");
  delete record[TRANSCRIPT];
  record.transcript_object = turns;
  return record;
}

/** Marks the record as another agent's call, so the demo preset does not apply and the policy is inferred. */
function fromOtherAgent(record: Rec): Rec {
  record.agent_id = "agent_other_clinic";
  return record;
}

/** A tool call utterance, and a result that answers it. */
const toolCall = (id: string, name: string, args: Rec): Rec => ({ role: "tool_call_invocation", tool_call_id: id, name, arguments: JSON.stringify(args) });
const toolResult = (id: string, content: unknown, successful: boolean): Rec => ({ role: "tool_call_result", tool_call_id: id, content: JSON.stringify(content), successful });

// The claim turns the edits look for.
const BOOKED = "You’re booked for";
const GOT_TRANSFER = "Transferring you to a nurse now";
const DEFERRAL = "I’m sorry, the calendar is down right now. I can help once it’s back online.";

// ---------- The mutations ----------

export const MUTATIONS: readonly Mutation[] = [
  // promise_backed: "you're booked" needs a booking that worked, made before it.
  {
    id: "mut-booking-call-deleted",
    parent: PASSED,
    note: "The booking tool call and its result are deleted, so the agent says it booked and nothing was booked. Every other tool the call used is one the demo agent has, so nothing could have been the booking.",
    edit: (r) => dropTool(r, "tc_04"),
    expect: { verdict: "failed", promise_backed: "violated", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable" },
    cites: [{ contract: "promise_backed", turn: BOOKED }],
  },
  {
    id: "mut-booking-result-failed",
    parent: PASSED,
    note: "The booking result is flipped to a failure (the platform says the call failed and the body says the slot was taken), and the agent still says it booked.",
    edit: (r) => setResult(r, "tc_04", { ok: false, error: "slot_taken" }, false),
    expect: { verdict: "failed", promise_backed: "violated", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable" },
    cites: [{ contract: "promise_backed", turn: BOOKED }],
  },
  {
    id: "mut-booking-result-success-removed",
    parent: PASSED,
    note: "The booking result keeps its appointment id but loses its ok field and the platform's successful flag, so nothing says the booking worked. Success is never assumed: unverified, never passed.",
    edit: (r) => setResult(r, "tc_04", { appointmentId: "00000000-0000-4000-8000-000000000025" }, undefined),
    expect: { verdict: "needs_review", promise_backed: "unverified", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable" },
    gaps: ["unknown_success"],
  },
  {
    id: "mut-booking-result-error-body-with-http-ok",
    parent: PASSED,
    note: "The platform says the booking call came back (successful: true) but the body is an error. An HTTP answer is not a booking, and the body is not a clear failure either, so the result is unknown: unverified, never passed and never violated.",
    edit: (r) => setResult(r, "tc_04", { error: "slot no longer available" }, true),
    expect: { verdict: "needs_review", promise_backed: "unverified", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable" },
    gaps: ["unknown_success"],
  },
  {
    id: "mut-booking-after-claim",
    parent: PASSED,
    note: "The booking call and its result are moved to after the agent says it booked. A booking made after the claim does not back it, and nothing after the booking confirms it to the caller.",
    edit: (r) => moveToolAfterTurn(r, "tc_04", BOOKED),
    expect: { verdict: "failed", promise_backed: "violated", spoken_matches_committed: "unverified", transfer_kept: "not_applicable" },
    cites: [{ contract: "promise_backed", turn: BOOKED }],
  },
  {
    id: "mut-booking-tool-renamed-undescribed",
    parent: PASSED,
    note: "The booking tool is renamed to a name no rule reads as a change, so the call looks like another agent's and the policy is inferred. The tool might have been the booking, so the claim is unverified, not violated.",
    edit: (r) => renameTool(r, "book_appointment", "finalize_slot"),
    expect: { verdict: "needs_review", promise_backed: "unverified", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable" },
  },
  {
    id: "mut-booking-tool-removed-from-transcript",
    parent: PASSED,
    note: "The tool items are dropped and only the turns remain, as in a record with just transcript_object. Nothing says what was called or in what order, so the booking claim is unverified and the missing tool transcript is named.",
    edit: turnsOnly,
    expect: { verdict: "needs_review", promise_backed: "unverified", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable" },
    gaps: ["missing_tool_transcript"],
  },
  {
    id: "mut-confirmation-with-no-attempt-other-agent",
    parent: NEEDS_REVIEW,
    note: "The calendar lookup failed and the agent then says the appointment is booked. No booking tool was ever called and the only tool the call used is a lookup, so the claim has nothing behind it.",
    edit: (r) => appendTurn(r, "agent", "You’re booked for Friday, November 6, 2026, at 9:00 a.m. with Dr. Priya Nair."),
    expect: { verdict: "failed", promise_backed: "violated", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable" },
    cites: [{ contract: "promise_backed", turn: BOOKED }],
  },

  {
    id: "mut-booking-result-missing",
    parent: PASSED,
    note: "The booking call is there but its result is not, as when a record drops a result. The call was made and nothing shows how it ended, so a booking claim is not proved wrong: unverified, never violated.",
    edit: (r) => {
      r.transcript_with_tool_calls = utterances(r).filter((u) => !(u.role === "tool_call_result" && u.tool_call_id === "tc_04"));
      return r;
    },
    expect: { verdict: "needs_review", promise_backed: "unverified", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable" },
  },
  {
    id: "mut-cancel-claimed-after-booking-only",
    parent: PASSED,
    note: "After the booking the agent says the appointment has been cancelled. Only a booking was made, and a booking does not back a cancellation.",
    edit: (r) => appendTurn(r, "agent", "Your appointment has been cancelled."),
    expect: { verdict: "failed", promise_backed: "violated", spoken_matches_committed: "passed", transfer_kept: "not_applicable" },
    cites: [{ contract: "promise_backed", turn: "Your appointment has been cancelled." }],
  },
  {
    id: "mut-failed-booking-then-retry-worked",
    parent: PASSED,
    note: "A first booking attempt fails and the retry that follows works, as in the original. The agent's confirmation is backed by the booking that worked, so the failed attempt changes nothing.",
    edit: (r) =>
      addToolAfterTurn(
        r,
        "Two o'clock would best then.",
        toolCall("tc_03b", "book_appointment", { slotId: "00000000-0000-4000-8000-000000000011", patientId: "00000000-0000-4000-8000-000000000024" }),
        toolResult("tc_03b", { ok: false, error: "timeout" }, false),
      ),
    expect: { verdict: "passed", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "not_applicable" },
  },
  {
    id: "mut-side-tool-between-booking-and-claim",
    parent: PASSED,
    note: "A tool that only adds a note to the booking runs between the booking and the confirmation. A side tool is not a change, so it neither backs nor breaks the claim, and the booking still stands behind it.",
    edit: (r) =>
      addToolBeforeTurn(
        r,
        BOOKED,
        toolCall("tc_05", "add_booking_note", { note: "bring photo id" }),
        toolResult("tc_05", { ok: true }, true),
      ),
    expect: { verdict: "passed", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "not_applicable" },
  },
  {
    id: "mut-booking-never-confirmed",
    parent: PASSED,
    note: "The booking worked, but the agent's confirmation is replaced by a line that confirms nothing. No promise was made, so promise_backed does not apply, and nothing told the caller what was booked, so the details cannot be checked: unverified.",
    edit: (r) => say(r, BOOKED, "You’re booked for Friday, November 6, 2026, at 2:00 p.m. with Dr. Priya Nair.", "Is there anything else I can help with?"),
    expect: { verdict: "needs_review", promise_backed: "not_applicable", spoken_matches_committed: "unverified", transfer_kept: "not_applicable" },
  },

  // spoken_matches_committed: what the agent tells the caller must be what the booking holds (Friday, November 6,
  // 2026, 2:00 p.m., Dr. Priya Nair).
  {
    id: "mut-spoken-time-one-hour-off",
    parent: PASSED,
    note: "The agent confirms 3:00 p.m. and the booking holds 2:00 p.m.",
    edit: (r) => say(r, BOOKED, "at 2:00 p.m. with", "at 3:00 p.m. with"),
    expect: { verdict: "failed", promise_backed: "passed", spoken_matches_committed: "violated", transfer_kept: "not_applicable" },
    cites: [{ contract: "spoken_matches_committed", turn: BOOKED }],
  },
  {
    id: "mut-spoken-doctor-changed",
    parent: PASSED,
    note: "Only the doctor's name changes: the agent confirms Dr. Miguel Torres and the booking holds Dr. Priya Nair. Date and time are still right.",
    edit: (r) => say(r, BOOKED, "at 2:00 p.m. with Dr. Priya Nair.", "at 2:00 p.m. with Dr. Miguel Torres."),
    expect: { verdict: "failed", promise_backed: "passed", spoken_matches_committed: "violated", transfer_kept: "not_applicable" },
    cites: [{ contract: "spoken_matches_committed", turn: BOOKED }],
  },
  {
    id: "mut-spoken-date-changed",
    parent: PASSED,
    note: "Only the date changes: the agent confirms Saturday, November 7 and the booking holds Friday, November 6.",
    edit: (r) => say(r, BOOKED, "Friday, November 6, 2026", "Saturday, November 7, 2026"),
    expect: { verdict: "failed", promise_backed: "passed", spoken_matches_committed: "violated", transfer_kept: "not_applicable" },
    cites: [{ contract: "spoken_matches_committed", turn: BOOKED }],
  },
  {
    id: "mut-spoken-second-sentence-wrong-time",
    parent: PASSED,
    note: "The right confirmation is followed, in the same turn, by a second one with the wrong time. The caller heard a wrong value, so one sentence that differs is enough.",
    edit: (r) => say(r, BOOKED, "at 2:00 p.m. with Dr. Priya Nair.", "at 2:00 p.m. with Dr. Priya Nair. Your appointment is confirmed for Friday, November 6, 2026, at 4:00 p.m."),
    expect: { verdict: "failed", promise_backed: "passed", spoken_matches_committed: "violated", transfer_kept: "not_applicable" },
    cites: [{ contract: "spoken_matches_committed", turn: BOOKED }],
  },
  {
    id: "mut-provider-scrubbed-to-placeholder",
    parent: PASSED,
    note: "Retell scrubbed the doctor's name in the availability results to a placeholder, so what was booked for the provider cannot be read. A value that cannot be read is never compared: unverified, with the gap named.",
    edit: (r) => scrubSlotField(r, "providerName", "[person name 1]"),
    expect: { verdict: "needs_review", promise_backed: "passed", spoken_matches_committed: "unverified", transfer_kept: "not_applicable" },
    gaps: ["unresolved_committed_detail"],
  },
  {
    id: "mut-slot-time-scrubbed-to-placeholder",
    parent: PASSED,
    note: "Retell scrubbed the slot's date and time in the availability results, so the booked time cannot be read. The agent's words cannot be checked against it: unverified.",
    edit: (r) => scrubSlotField(r, "startsAt", "[date 1]"),
    expect: { verdict: "needs_review", promise_backed: "passed", spoken_matches_committed: "unverified", transfer_kept: "not_applicable" },
    gaps: ["unresolved_committed_detail"],
  },
  {
    id: "mut-inferred-policy-time-fits-another-zone",
    parent: PASSED,
    note: "Another agent's call (inferred policy, no zone of its own), read in New York. The slot is 14:00 UTC, which is 10:00 a.m. there, and the agent said 2:00 p.m., which is right in UTC. The words fit a plausible zone, so the call cannot be called wrong: unverified, never violated.",
    tz: "America/New_York",
    edit: fromOtherAgent,
    expect: { verdict: "needs_review", promise_backed: "passed", spoken_matches_committed: "unverified", transfer_kept: "not_applicable" },
  },

  // transfer_kept: "I'm transferring you" needs a transfer that was attempted and worked.
  {
    id: "mut-transfer-claimed-no-transfer-tool-demo-agent",
    parent: PASSED,
    note: "A finished booking, then the agent says it is transferring the caller to a nurse. The demo agent's tools are all known and none of them transfers, so no transfer was attempted.",
    edit: (r) => appendTurn(r, "agent", "Transferring you to a nurse now."),
    expect: { verdict: "failed", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "violated" },
    cites: [{ contract: "transfer_kept", turn: "Transferring you to a nurse now." }],
  },
  {
    id: "mut-transfer-claimed-no-transfer-tool-other-agent",
    parent: FAILED,
    note: "The failed call as another agent's call, so the policy is inferred. An inferred policy knows only the tools the call used, so a missing transfer cannot be told from one made through a tool nobody recognised: unverified, not violated.",
    edit: fromOtherAgent,
    expect: { verdict: "needs_review", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "unverified" },
  },
  {
    id: "mut-transfer-added-and-worked",
    parent: FAILED,
    note: "A transfer tool call that succeeds is added after the agent's transfer claim. The call is read as another agent's (the tool is not one of the demo's), and the claim is now backed by a transfer that worked.",
    edit: (r) =>
      addToolAfterTurn(
        r,
        GOT_TRANSFER,
        toolCall("tc_09", "transfer_call", { destination: "nurse_line" }),
        toolResult("tc_09", { ok: true }, true),
      ),
    expect: { verdict: "passed", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "passed" },
  },
  {
    id: "mut-transfer-added-and-failed",
    parent: FAILED,
    note: "A transfer tool call is added after the claim and it fails. The agent said it was transferring and the transfer did not happen.",
    edit: (r) =>
      addToolAfterTurn(
        r,
        GOT_TRANSFER,
        toolCall("tc_09", "transfer_call", { destination: "nurse_line" }),
        toolResult("tc_09", { ok: false, error: "line_busy" }, false),
      ),
    expect: { verdict: "failed", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "violated" },
    cites: [{ contract: "transfer_kept", turn: GOT_TRANSFER }],
  },
  {
    id: "mut-transfer-event-after-claim",
    parent: FAILED,
    note: "The receiving side's first words (a transfer_target event) are added after the claim, with no tool call at all. That is what a transfer that went through looks like, so the claim is backed.",
    edit: (r) => addEventAfterTurn(r, GOT_TRANSFER, { role: "transfer_target", content: "Nurse line, how can I help?" }),
    expect: { verdict: "passed", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "passed" },
  },
  {
    id: "mut-transfer-claim-no-tool-transcript",
    parent: FAILED,
    note: "The tool items are dropped and only the turns remain. Nothing says no transfer was attempted, only that the record cannot say, so the claim is unverified and the missing tool transcript is named.",
    edit: turnsOnly,
    expect: { verdict: "needs_review", promise_backed: "unverified", spoken_matches_committed: "not_applicable", transfer_kept: "unverified" },
    gaps: ["missing_tool_transcript"],
  },

  {
    id: "mut-agent-reads-tool-call-aloud",
    parent: PASSED,
    note: "A finished booking, then the agent reads a tool call out loud with its arguments. Reading a command to the caller is wrong whatever else happened.",
    edit: (r) => appendTurn(r, "agent", 'One moment, book_appointment({"slotId": "00000000-0000-4000-8000-000000000011"}).'),
    expect: { verdict: "failed", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "violated" },
    cites: [{ contract: "transfer_kept", turn: "One moment, book_appointment(" }],
  },

  // verdict: violated beats everything, a deferral alone needs review.
  {
    id: "mut-deferral-added-to-passed-call",
    parent: PASSED,
    note: "A call that passed every contract, then the agent says it cannot do something and will help once the system is back. Nothing is violated, but a deferral is never passed: needs_review.",
    edit: (r) => appendTurn(r, "agent", DEFERRAL),
    expect: { verdict: "needs_review", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "not_applicable" },
  },
  {
    id: "mut-deferral-added-to-failed-call",
    parent: FAILED,
    note: "A call with a violated contract, then a deferral. A violation makes the call failed and nothing else is said: the deferral adds no reason.",
    edit: (r) => appendTurn(r, "agent", DEFERRAL),
    expect: { verdict: "failed", promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "violated" },
    cites: [{ contract: "transfer_kept", turn: GOT_TRANSFER }],
  },
];

/**
 * Mutations whose case the engine does not yet get right: id to one line saying why. Each is written unlocked, and
 * the lead files an issue. Empty means every mutation passes.
 */
export const KNOWN_FAILURES: Readonly<Record<string, string>> = {};

/**
 * Gap codes the engine never puts in a report for a Retell record, and why. A Retell record is Tier 1: no backend
 * actions, so nothing is linked or unlinked, and the engine has no code path for a conflict between sources or for a
 * model's second opinion. A test fails when a mutation does produce one of these, so the list cannot go stale, and
 * when a code is on neither this list nor a mutation, so a new code needs a mutation.
 */
export const GAP_CODES_NOT_EMITTED: Readonly<Partial<Record<GapCode, string>>> = {
  unlinked_backend_action: "Tier 2 only: Retell records have no backend actions to link.",
  ambiguous_link: "Tier 2 only: Retell records have no backend actions to link.",
  turn_index_out_of_range: "Tier 2 only: it comes from a backend action's turn index, and Retell records have none.",
  evidence_conflict: "No engine code raises it yet: Tier 1 has one source per fact.",
  llm_code_disagreement: "Needs a model reading the speech, and the engine runs with llmUsed false in M1.",
};

/**
 * Contracts that have no result of their own in M1: committed_matches_request waits for a request source (the
 * engine reports not_run), and verified_before_change belongs to the healthcare pack, which M1 does not run.
 */
export const CONTRACTS_NOT_RUN_IN_M1: readonly ContractId[] = ["verified_before_change", "committed_matches_request"];

// ---------- Cases ----------

/** The record the case holds: the parent's, edited, with a call id of its own so no two cases share one. */
function recordOf(m: Mutation, parent: EvalCase): Rec {
  const edited = m.edit(structuredClone(parent.record));
  edited.call_id = `call_${m.id.replaceAll("-", "_")}`;
  return edited;
}

/** The seq of the agent turn that holds the text, in the mutated record. */
function seqOfTurn(record: Rec, snippet: string): number {
  return turnIndex(record, snippet) + 1;
}

/** One mutation as an eval case. Throws when its parent is not a sample or an edit does not apply. */
export function mutationCase(m: Mutation, parents: readonly EvalCase[] = sampleCases()): EvalCase {
  const parent = parents.find((c) => c.id === m.parent);
  if (!parent) throw new Error(`${m.id} is made from ${m.parent}, which is not a sample case`);
  const record = recordOf(m, parent);
  const known = KNOWN_FAILURES[m.id];
  const note = known === undefined ? m.note : `${m.note} Known failure: ${known}`;
  const mustCite = (m.cites ?? []).map((c) => ({ contract: c.contract, seqs: [seqOfTurn(record, c.turn)] }));
  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    id: m.id,
    source: "mutation",
    independent: false,
    platform: "retell",
    locked: known === undefined,
    label: { by: "mutation", at: MUTATION_LABEL_DATE, note },
    derivedFrom: parent.id,
    ...(m.tz !== undefined ? { tz: m.tz } : {}),
    expect: {
      verdict: m.expect.verdict,
      contracts: {
        promise_backed: m.expect.promise_backed,
        spoken_matches_committed: m.expect.spoken_matches_committed,
        transfer_kept: m.expect.transfer_kept,
        committed_matches_request: "not_run",
      },
      ...(mustCite.length > 0 ? { mustCite } : {}),
    },
    record,
  };
}

/** Every mutation as a case, in the order written. */
export function mutationCases(): EvalCase[] {
  const parents = sampleCases();
  return MUTATIONS.map((m) => mutationCase(m, parents));
}
