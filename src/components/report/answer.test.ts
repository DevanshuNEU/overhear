import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";
import { answerOf } from "./answer";

describe("answerOf", () => {
  it("is the top broken finding's own sentence, with a count when the rule broke more than once", () => {
    expect(answerOf(failedSample)).toBe("At 2:01 the agent said it was transferring the caller. No transfer was attempted. This happened twice.");
  });

  it("adds no count when the rule broke once", () => {
    const once = {
      ...failedSample,
      results: failedSample.results.map((c) => (c.contract === "transfer_kept" ? { ...c, findings: c.findings.slice(0, 1) } : c)),
    };
    expect(answerOf(once)).toBe("At 2:01 the agent said it was transferring the caller. No transfer was attempted.");
  });

  it("says how many times for three or more", () => {
    const base = failedSample.results.find((c) => c.contract === "transfer_kept")!;
    const three = {
      ...failedSample,
      results: failedSample.results.map((c) => (c.contract === "transfer_kept" ? { ...c, findings: [...base.findings, base.findings[0]] } : c)),
    };
    expect(answerOf(three)).toMatch(/This happened 3 times\.$/);
  });

  it("is the first review reason's sentence for a call that needs review", () => {
    expect(answerOf(needsReviewSample)).toBe(needsReviewSample.reasons[0].text);
  });

  it("counts the rules that could not be checked when there is more than one", () => {
    expect(answerOf(unverifiedSample)).toBe(`${unverifiedSample.reasons[0].text} 3 rules couldn't be checked.`);
  });

  it("is nothing for a passed call, which keeps its stored headline alone", () => {
    expect(answerOf(passedSample)).toBeNull();
  });

  it("uses only words the report or labels.ts hold, never a made up claim", () => {
    const text = answerOf(failedSample)!;
    const allowed = failedSample.results.flatMap((c) => c.findings.map((f) => f.text)).join(" ");
    expect(allowed).toContain(text.split(" This happened")[0]);
  });
});
