// What every contract shares (spec 6.4): the context a contract reads, the worst of several results, the gaps that
// touch a finding's evidence, and the softening of a violated finding when the record has no tool calls to check.
// Pure: a contract reads its context and returns a result. The one thing it may add is a gap to the evidence it was
// handed (softenForMissingTools), which the pipeline owns.
import { GAP_CODES, type ContractId, type ContractResult, type Detection, type Evidence, type Finding, type Gap, type GapCode, type Policy, type Result } from "@/report/schema";
import type { ToolUse } from "../committed";
import { GAP_DETAIL, GAP_TEXT, unverifiedText } from "../wording";

/** What a contract reads. The pipeline builds it once per call, after resolveOk and the speech detector. */
export interface ContractContext {
  /** The evidence after resolveOk. A contract may add a gap to it (softenForMissingTools) and nothing else. */
  ev: Evidence;
  policy: Policy;
  /**
   * Where the policy came from (policyFor). Only a preset describes every tool its agent has, so only a preset can
   * show that a call the record lacks was never made; an inferred policy knows just the tools the call used.
   */
  policySource: "preset" | "inferred";
  /** The time zone spoken times are read in: the policy's when it names one, else the caller's. */
  tz: string;
  /** Whether tz is the policy's own. */
  policyTz: boolean;
  detections: Detection[];
  /** The calls to change tools, in the order they were made, with their results. */
  changes: ToolUse[];
  providerNames: string[];
}

/** One contract: the call in, its result and findings out. */
export type Contract = (ctx: ContractContext) => ContractResult;

const RANK: Record<Result, number> = { violated: 3, unverified: 2, passed: 1, not_applicable: 0, not_run: -1 };

/** The worst of several results, in the order violated, unverified, passed, not_applicable. Nothing is not_applicable. */
export function worst(results: Result[]): Result {
  return results.reduce<Result>((w, r) => (RANK[r] > RANK[w] ? r : w), "not_applicable");
}

const WITHOUT_DETAILS = GAP_CODES.filter((c) => c !== "unresolved_committed_detail");

/**
 * The gap codes that can make each contract's findings unverified. A booking detail the record can't resolve says
 * nothing about whether a promise was backed, whether identity was checked or whether a transfer happened, so those
 * contracts ignore it. The two that compare details count every code.
 */
export const RELEVANT_GAPS: Record<ContractId, readonly GapCode[]> = {
  promise_backed: WITHOUT_DETAILS,
  verified_before_change: WITHOUT_DETAILS,
  transfer_kept: WITHOUT_DETAILS,
  spoken_matches_committed: GAP_CODES,
  committed_matches_request: GAP_CODES,
};

/**
 * The gaps in the evidence that touch what a finding rests on: those of a code the contract counts that cite one of
 * the seqs. The seqs are the deciding evidence: the claim's turn, the tool call and its result. A gap with no seqs
 * cites nothing, so it touches nothing.
 */
export function gapsTouching(ev: Evidence, contract: ContractId, seqs: number[]): Gap[] {
  const relevant = RELEVANT_GAPS[contract];
  return ev.gaps.filter((g) => relevant.includes(g.code) && g.seqs.some((s) => seqs.includes(s)));
}

/**
 * A violated finding that rests on a missing tool call, softened when the record has no tool calls and no backend
 * action to stand in for one (6.4): it can't prove the call was never made, only that the record can't say. The
 * finding becomes unverified, names missing_tool_transcript, and the gap joins ev.gaps when it isn't there already.
 * Any other finding is returned as it came. The caller passes only findings caused by an absence: a violated
 * finding that rests on something else (a failure, words read out) must not come here.
 */
export function softenForMissingTools(ev: Evidence, finding: Finding, contract: ContractId): Finding {
  if (finding.result !== "violated") return finding;
  if (ev.items.some((it) => it.kind === "tool_call" || it.kind === "backend_action")) return finding;
  if (!ev.gaps.some((g) => g.code === "missing_tool_transcript")) {
    ev.gaps.push({ code: "missing_tool_transcript", detail: GAP_DETAIL.missing_tool_transcript, seqs: [] });
  }
  return {
    ...finding,
    result: "unverified",
    text: unverifiedText(contract, [GAP_TEXT.missing_tool_transcript]),
    gaps: [...new Set<GapCode>([...finding.gaps, "missing_tool_transcript"])],
  };
}
