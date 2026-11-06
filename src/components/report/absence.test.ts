import { describe, expect, it } from "vitest";
import { failedSample } from "@/report/samples";
import { ABSENCE_VARIANTS, brokenPromise, untranscribedAction } from "@/report/samples/variants.fixture";
import type { CallReport, ContractId } from "@/report/schema";
import { absenceIsProven, toolListIsComplete } from "./absence";

const findingsOf = (r: CallReport, contract: ContractId) => r.results.find((c) => c.contract === contract)!.findings;
const proven = (r: CallReport, contract: ContractId) => findingsOf(r, contract).map((f) => absenceIsProven(r.evidence, r.policy, contract, f));

describe("absenceIsProven", () => {
  it("holds for each broken transfer in the failed sample: an ordered, complete record with nothing after the claim", () => {
    expect(proven(failedSample, "transfer_kept")).toEqual([true, true]);
  });

  it("does not hold for a transfer the record cannot rule out", () => {
    // (a) a transfer_call the policy does not name, (b) timestamp order, (c) an unlinked transfer_call in the backend log.
    for (const [name, report] of Object.entries(ABSENCE_VARIANTS)) {
      expect(proven(report, "transfer_kept"), name).toEqual([false, false]);
    }
  });

  it("does not hold for a promise when a tool that changes a booking came before it", () => {
    expect(proven(brokenPromise, "promise_backed")).toEqual([false]);
  });

  it("holds only for a broken finding, and only for the rules that rest on an absence", () => {
    const transfer = findingsOf(failedSample, "transfer_kept")[0];
    expect(absenceIsProven(failedSample.evidence, failedSample.policy, "transfer_kept", { ...transfer, result: "unverified" })).toBe(false);
    expect(absenceIsProven(failedSample.evidence, failedSample.policy, "spoken_matches_committed", transfer)).toBe(false);
  });
});

describe("toolListIsComplete", () => {
  it("holds for a call record with no gap in its tools", () => {
    expect(toolListIsComplete(failedSample.evidence)).toBe(true);
  });

  it("does not hold when the backend log holds an action the transcript does not", () => {
    expect(toolListIsComplete(ABSENCE_VARIANTS.unlinkedTransferAction.evidence)).toBe(false);
    expect(toolListIsComplete(untranscribedAction.evidence)).toBe(false);
  });

  it("does not hold when a gap says tool calls are missing or point outside the transcript", () => {
    for (const code of ["missing_tool_transcript", "unlinked_backend_action", "turn_index_out_of_range"] as const) {
      const e = { ...failedSample.evidence, gaps: [{ code, detail: "x", seqs: [] }] };
      expect(toolListIsComplete(e), code).toBe(false);
    }
  });
});
