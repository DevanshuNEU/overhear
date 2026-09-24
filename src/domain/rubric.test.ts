import { describe, it, expect } from "vitest";
import { DIMENSION_WEIGHTS, composite } from "./rubric";
import type { DimensionScore } from "./types";

const dim = (key: DimensionScore["key"], score: number): DimensionScore =>
  ({ key, tier: "objective", score, passed: score >= 0.5, confidence: null, rationale: "" });

describe("rubric", () => {
  it("weights cover all seven dimensions and sum to 1.0", () => {
    const keys = Object.keys(DIMENSION_WEIGHTS).sort();
    expect(keys).toEqual([
      "confirmed_before_acting", "conversational_quality", "correct_tool_use",
      "identity_verified", "no_hallucination", "safety_escalation", "task_success",
    ]);
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 1000) / 1000).toBe(1);
  });

  it("composites the weighted dimension scores to 0..100", () => {
    const dims = (Object.keys(DIMENSION_WEIGHTS) as (keyof typeof DIMENSION_WEIGHTS)[])
      .map((key): DimensionScore => ({ key, tier: "subjective", score: 1, passed: true, confidence: null, rationale: "" }));
    expect(composite(dims)).toBe(100);
  });

  it("a single failed high-weight dimension drags the composite down", () => {
    const dims = (Object.keys(DIMENSION_WEIGHTS) as DimensionScore["key"][])
      .map((k) => dim(k, k === "task_success" ? 0 : 1));
    expect(composite(dims)).toBeCloseTo(78, 5); // 1 - 0.22
  });
});
