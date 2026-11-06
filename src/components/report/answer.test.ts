import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";
import type { CallReport } from "@/report/schema";
import { answerOf } from "./answer";

const withTransferFindings = (n: number): CallReport => {
  const base = failedSample.results.find((c) => c.contract === "transfer_kept")!.findings;
  return {
    ...failedSample,
    results: failedSample.results.map((c) => (c.contract === "transfer_kept" ? { ...c, findings: Array.from({ length: n }, (_, i) => base[i % base.length]) } : c)),
  };
};

describe("answerOf", () => {
  it("is the finding's own sentence when one finding broke, and says which finding it used", () => {
    expect(answerOf(withTransferFindings(1))).toEqual({
      text: "At 2:01 the agent said it was transferring the caller. No transfer was attempted.",
      source: { kind: "finding", contract: "transfer_kept", index: 0 },
    });
  });

  it("is the rule's template, filled with the count and the times, when it broke more than once", () => {
    expect(answerOf(failedSample)).toEqual({
      text: "The agent said twice that it was transferring the caller, at 2:01 and 2:22. No transfer was attempted.",
      source: { kind: "template" },
    });
    expect(answerOf(withTransferFindings(3))!.text).toBe("The agent said 3 times that it was transferring the caller, at 2:01, 2:22 and 2:01. No transfer was attempted.");
  });

  it("leaves the times out when a claim has no time", () => {
    const noTimes: CallReport = {
      ...failedSample,
      evidence: { ...failedSample.evidence, items: failedSample.evidence.items.map((it) => (it.seq === 27 && it.kind === "turn" ? { ...it, startSec: null } : it)) },
    };
    expect(answerOf(noTimes)!.text).toBe("The agent said twice that it was transferring the caller. No transfer was attempted.");
  });

  it("falls back to the first finding's sentence and a count for a rule with no template", () => {
    const text = answerOf(failedSample, {})!.text;
    expect(text).toBe("At 2:01 the agent said it was transferring the caller. No transfer was attempted. This happened twice.");
  });

  it("is the first review reason's sentence for a call that needs review, and says which reason", () => {
    expect(answerOf(needsReviewSample)).toEqual({ text: needsReviewSample.reasons[0].text, source: { kind: "reason", index: 0 } });
  });

  it("counts the rules that could not be checked when there is more than one", () => {
    expect(answerOf(unverifiedSample)).toEqual({ text: `${unverifiedSample.reasons[0].text} 3 rules couldn't be checked.`, source: { kind: "reason", index: 0 } });
  });

  it("is nothing for a passed call, which keeps its stored headline alone", () => {
    expect(answerOf(passedSample)).toBeNull();
  });
});
