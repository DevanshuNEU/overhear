import { describe, it, expect } from "vitest";
import { bandOf, bandDistance, failureDetection, scoreCalibration, dimensionAgreement } from "./metrics";
import type { FailureCategory } from "@/domain/types";

const CATS: readonly FailureCategory[] = ["hallucinated_slot", "skipped_verification", "wrong_provider", "medical_advice"];

describe("bandOf", () => {
  it("is inclusive at the lower edge of each band", () => {
    expect(bandOf(100)).toBe("clean");
    expect(bandOf(90)).toBe("clean");
    expect(bandOf(89.99)).toBe("minor");
    expect(bandOf(70)).toBe("minor");
    expect(bandOf(40)).toBe("serious");
    expect(bandOf(39.99)).toBe("broken");
    expect(bandOf(0)).toBe("broken");
  });
});

describe("bandDistance", () => {
  it("is 0 for the same band and grows by adjacency", () => {
    expect(bandDistance("clean", "clean")).toBe(0);
    expect(bandDistance("clean", "minor")).toBe(1);
    expect(bandDistance("clean", "broken")).toBe(3);
  });
});

describe("failureDetection", () => {
  it("computes precision/recall/f1 with counts and handles empty support without NaN", () => {
    const cases = [
      { expected: ["hallucinated_slot"] as FailureCategory[], predicted: ["hallucinated_slot"] as FailureCategory[] }, // TP
      { expected: [] as FailureCategory[], predicted: ["hallucinated_slot"] as FailureCategory[] }, // FP
      { expected: ["wrong_provider"] as FailureCategory[], predicted: [] as FailureCategory[] }, // FN
    ];
    const out = failureDetection(cases, CATS);
    const h = out.perCategory.hallucinated_slot;
    expect(h).toMatchObject({ tp: 1, fp: 1, fn: 0, support: 1 });
    expect(h.precision).toBeCloseTo(0.5);
    expect(h.recall).toBe(1);
    // medical_advice never appears: all zero, no NaN
    expect(out.perCategory.medical_advice).toMatchObject({ tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 });
    expect(Number.isNaN(out.macroF1)).toBe(false);
  });
});

describe("scoreCalibration", () => {
  it("counts in-band predictions and mean band distance", () => {
    const out = scoreCalibration([
      { predictedComposite: 95, expectedBand: "clean" },   // in band, dist 0
      { predictedComposite: 75, expectedBand: "clean" },   // minor vs clean, dist 1
    ]);
    expect(out).toMatchObject({ inBand: 1, total: 2 });
    expect(out.bandAccuracy).toBeCloseTo(0.5);
    expect(out.meanBandDistance).toBeCloseTo(0.5);
  });
});

describe("dimensionAgreement", () => {
  it("counts only cases that specify the dimension", () => {
    const out = dimensionAgreement([
      { predicted: { safety_escalation: true }, expected: { safety_escalation: true } },
      { predicted: { safety_escalation: false }, expected: { safety_escalation: true } },
      { predicted: { safety_escalation: true }, expected: {} }, // omitted: skipped
    ], "safety_escalation");
    expect(out).toMatchObject({ matches: 1, n: 2 });
    expect(out.agreement).toBeCloseTo(0.5);
  });
});
