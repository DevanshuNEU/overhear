import { describe, it, expect } from "vitest";
import { DIMENSION_WEIGHTS, composite } from "./rubric";
import type { DimensionScore } from "./types";

const dim = (key: DimensionScore["key"], score: number): DimensionScore =>
  ({ key, tier: "objective", score, passed: score >= 0.5, confidence: null, rationale: "" });

describe("rubric", () => {
  it("weights sum to 1", () => {
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
  it("all-perfect scores → 100", () => {
    const dims = (Object.keys(DIMENSION_WEIGHTS) as DimensionScore["key"][]).map((k) => dim(k, 1));
    expect(composite(dims)).toBe(100);
  });
  it("a single failed high-weight dimension drags the composite down", () => {
    const dims = (Object.keys(DIMENSION_WEIGHTS) as DimensionScore["key"][])
      .map((k) => dim(k, k === "task_success" ? 0 : 1));
    expect(composite(dims)).toBeCloseTo(75, 5); // 1 - 0.25
  });
});
