import { describe, expect, it } from "vitest";
import { SAMPLE_CASES, demoSamples, sampleReport, sampleRows } from "./index";

describe("the demo samples", () => {
  it("lists the nine cases in order", () => {
    expect(SAMPLE_CASES.map((c) => c.id)).toEqual([
      "sample-failed",
      "mut-booking-result-failed",
      "mut-spoken-time-one-hour-off",
      "mut-transfer-claim-caller-kept-asking-then-left",
      "sample-needs-review",
      "mut-transfer-claim-caller-hung-up-during",
      "sample-passed",
      "mut-transfer-added-and-worked",
      "mut-short-empty-call",
    ]);
  });

  it.each(SAMPLE_CASES.map((c) => [c.id, c] as const))("%s has the verdict its case expects", (id, c) => {
    const sample = demoSamples().find((s) => s.id === id);
    expect(sample?.report.verdict).toBe(c.expect.verdict);
    expect(sample?.row.verdict).toBe(c.expect.verdict);
  });

  it("is checked once and kept", () => {
    expect(demoSamples()).toBe(demoSamples());
  });

  it("has a row and a report for every sample, under the same call id", () => {
    for (const row of sampleRows()) expect(sampleReport(row.callId)?.callId).toBe(row.callId);
    expect(sampleReport("call_nope")).toBeUndefined();
  });
});
