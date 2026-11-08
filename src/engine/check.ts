// checkCall: every check on one call, in order, into one report (spec 6.4 to 6.6).
//
// Order: settle every tool result's success (resolveOk), read the agent's speech (detectAll), list the calls that
// change something, add the gaps the committed details raise to the evidence, then run the contracts and settle the
// verdict. The gaps go in before any contract runs because the report schema rejects a finding that cites a gap the
// evidence does not list. M1 runs the scheduling pack, which has no request source yet, so committed_matches_request
// is not_run and the report's policy lists the scheduling pack whatever pack the policy it was given names.
//
// Pure: the evidence and policy are read, never changed, and the time zone comes in through the options.
import { SCHEMA_VERSION, type CallReport, type ContractId, type ContractResult, type Evidence, type Policy } from "@/report/schema";
import { changes, committedDetails, providerNames } from "./committed";
import type { Contract, ContractContext } from "./contracts/common";
import { promiseBacked } from "./contracts/promise-backed";
import { spokenMatchesCommitted } from "./contracts/spoken-matches-committed";
import { transferKept } from "./contracts/transfer-kept";
import { detectAll } from "./detect-speech";
import { runExperience } from "./experience";
import { M1_CONTRACTS } from "./policy";
import { resolveOk } from "./resolve-ok";
import type { EngineOptions } from "./types";
import { verdictFor } from "./verdict";

export interface CheckOptions extends EngineOptions {
  /**
   * Where the policy came from (policyFor). Only a preset describes every tool its agent has, so only a preset can
   * show that a call the record lacks was never made. Required, so no caller gets a source it did not choose.
   */
  policySource: "preset" | "inferred";
}

/** The contracts M1 can run. committed_matches_request waits for a request source, so it has no entry. */
const CONTRACTS: Partial<Record<ContractId, Contract>> = {
  promise_backed: promiseBacked,
  spoken_matches_committed: spokenMatchesCommitted,
  transfer_kept: transferKept,
};

/** One call's report under the scheduling pack. */
export function checkCall(input: Evidence, policy: Policy, opts: CheckOptions): CallReport {
  const evidence = resolveOk(input, policy);
  const toolNames = [...new Set([...Object.keys(policy.tools), ...evidence.items.flatMap((it) => (it.kind === "tool_call" ? [it.name] : []))])];
  const detections = detectAll(evidence, toolNames);
  const changeList = changes(evidence, policy);
  // Only a change that worked has details a finding can cite (spoken_matches_committed reads just those), so a
  // failed or unsettled change adds no gap: it would show a reader something nothing rests on.
  for (const change of changeList.filter((c) => c.ok === true)) evidence.gaps.push(...committedDetails(evidence, policy, change).gaps);

  const ctx: ContractContext = {
    ev: evidence,
    policy,
    policySource: opts.policySource,
    tz: policy.timezone ?? opts.tz,
    policyTz: policy.timezone !== undefined,
    detections,
    changes: changeList,
    providerNames: providerNames(evidence, policy),
  };
  const results = M1_CONTRACTS.map((id): ContractResult => {
    const contract = CONTRACTS[id];
    return contract ? contract(ctx) : { contract: id, result: "not_run", findings: [] };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    callId: evidence.callId,
    platform: evidence.platform,
    ...verdictFor(results, detections, evidence),
    experience: runExperience(evidence, { detections }),
    results,
    detections,
    llmUsed: false,
    request: null,
    requestSource: null,
    timezone: ctx.tz,
    policy: { ...structuredClone(policy), packs: ["scheduling"] },
    evidence,
  };
}
