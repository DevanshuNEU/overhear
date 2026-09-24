import { describe, it, expect } from "vitest";
import report from "../../eval/report.json";
import { DIMENSION_WEIGHTS } from "@/domain/rubric";

describe("committed eval report is fresh", () => {
  it("was generated against the current dimension set and weights", () => {
    const codeKeys = Object.keys(DIMENSION_WEIGHTS).sort();
    expect([...report.rubric.dimensionKeys].sort()).toEqual(codeKeys);
    for (const k of codeKeys) {
      expect(report.rubric.weights[k as keyof typeof DIMENSION_WEIGHTS])
        .toBeCloseTo(DIMENSION_WEIGHTS[k as keyof typeof DIMENSION_WEIGHTS]);
    }
  });
});
