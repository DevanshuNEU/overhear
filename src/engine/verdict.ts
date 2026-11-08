// The verdict (spec 6.6 and 6.8): what the contract results and the speech detections add up to.
//
// failed when any contract is violated, and then nothing else is said: a failed call carries no reasons or notes.
// needs_review when no contract is violated and something could not be checked or the agent deferred. passed
// otherwise, with the notes that say why a pass is thin. The headline is the wording table's line (headlineFor), so
// the dashboard and the engine say the same thing.
//
// nothing_done is the one case carved out of passed: a call where the caller said almost nothing and the agent did
// nothing (see nothingDone). Precision over recall: a call that is not clearly empty stays passed.
//
// M1 has no request source, so an unanswered request is never a reason here.
import { headlineFor } from "@/report/labels";
import type { ContractResult, Detection, Evidence, Finding, Note, ReviewReason, Verdict } from "@/report/schema";
import { deferralReasonText, formatTime } from "./wording";

/** A caller who says this many words or fewer in a whole call has not asked for anything. */
export const NOTHING_DONE_MAX_CALLER_WORDS = 10;

export interface VerdictParts {
  verdict: Verdict;
  notes: Note[];
  headline: string;
  reasons: ReviewReason[];
}

/**
 * The verdict for a call, with its notes, headline and reasons. ev is the evidence the results were judged on,
 * after every gap was added: a reason borrows the words of the gap behind it, and a time comes from a turn.
 * Reasons come in the order the headline prefers them: unverified results in contract order, then the deferral.
 * There is at most one reason per kind and contract; a deferral reason carries every deferral turn in seqs.
 */
export function verdictFor(results: ContractResult[], detections: Detection[], ev: Evidence): VerdictParts {
  if (results.some((r) => r.result === "violated")) {
    return { verdict: "failed", notes: [], headline: headlineFor("failed", [], []), reasons: [] };
  }

  const reasons: ReviewReason[] = results.filter((r) => r.result === "unverified").map((r) => unverifiedReason(r, ev));
  const deferrals = detections.filter((d) => d.cls === "deferral");
  if (deferrals.length > 0) reasons.push(deferralReason(deferrals, ev));

  if (reasons.length > 0) {
    return { verdict: "needs_review", notes: [], headline: headlineFor("needs_review", [], reasons), reasons };
  }

  const ran = results.filter((r) => r.result !== "not_run");
  if (nothingDone(ran, detections, ev)) return { verdict: "nothing_done", notes: [], headline: headlineFor("nothing_done", [], []), reasons: [] };
  const notes: Note[] = [];
  if (ran.every((r) => r.result === "not_applicable")) notes.push("no_promises_made");
  if (results.some((r) => r.contract === "committed_matches_request" && r.result === "not_run")) notes.push("request_not_checked");
  return { verdict: "passed", notes, headline: headlineFor("passed", notes, []), reasons: [] };
}

/**
 * True for a call that would have passed where every contract that ran did not apply, nothing was done (no tool
 * call, no backend action), the agent claimed no completion, transfer, refusal or deferral, and the caller said at
 * most NOTHING_DONE_MAX_CALLER_WORDS words. At least one contract must have run, and the evidence must show the
 * tool calls: a turns-only record (ordering none, or a missing_tool_transcript gap) never reads nothing_done.
 * ran is the results that are not not_run.
 */
function nothingDone(ran: ContractResult[], detections: Detection[], ev: Evidence): boolean {
  if (ran.length === 0 || !ran.every((r) => r.result === "not_applicable")) return false;
  // With no tool items in the record (turns only), "no tool calls" is only what we cannot see, not what happened.
  if (ev.ordering === "none" || ev.gaps.some((g) => g.code === "missing_tool_transcript")) return false;
  if (ev.items.some((it) => it.kind === "tool_call" || it.kind === "backend_action")) return false;
  if (detections.some((d) => d.cls === "completion" || d.cls === "transfer" || d.cls === "refusal" || d.cls === "deferral")) return false;
  const words = ev.items.reduce((n, it) => (it.kind === "turn" && it.role === "caller" ? n + wordCount(it.text) : n), 0);
  return words <= NOTHING_DONE_MAX_CALLER_WORDS;
}

const wordCount = (text: string): number => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

const sorted = (seqs: Iterable<number>): number[] => [...new Set(seqs)].sort((a, b) => a - b);

/**
 * Why one contract could not be checked. Its findings that could not be checked each say what is missing: the
 * detail of the gap behind it when a gap in the evidence has the code the finding cites and touches its turns (a gap
 * with no seqs, like a missing tool transcript, belongs to the whole call), else the finding's own words. The screen
 * says a gap's detail once, under what could not be checked, so using it here lets it drop the repeat.
 */
function unverifiedReason(result: ContractResult, ev: Evidence): ReviewReason {
  const unverified = result.findings.filter((f) => f.result === "unverified");
  const text = [...new Set(unverified.flatMap((f) => causeOf(f, ev)))].join(" ");
  return {
    kind: "unverified_result",
    contract: result.contract,
    text,
    seqs: sorted(unverified.flatMap((f) => [...f.said, ...f.did])),
  };
}

function causeOf(finding: Finding, ev: Evidence): string[] {
  const touched = new Set([...finding.said, ...finding.did]);
  const gaps = ev.gaps.filter((g) => finding.gaps.includes(g.code) && (g.seqs.length === 0 || g.seqs.some((s) => touched.has(s))));
  return gaps.length > 0 ? gaps.map((g) => g.detail) : [finding.text];
}

/** The one deferral reason: each deferring turn once, in turn order, quoting the first deferral found at it. */
function deferralReason(deferrals: Detection[], ev: Evidence): ReviewReason {
  const bySeq = new Map<number, Detection>();
  for (const d of [...deferrals].sort((a, b) => a.seq - b.seq)) if (!bySeq.has(d.seq)) bySeq.set(d.seq, d);
  const turns = [...bySeq.values()].map((d) => ({ time: formatTime(d.seq, ev), quote: d.quote }));
  return { kind: "deferral", text: deferralReasonText(turns), seqs: [...bySeq.keys()] };
}
