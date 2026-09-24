import { describe, it, expect } from "vitest";
import { SUBJECTIVE_DIMENSIONS, PASS_THRESHOLD, derivePassed } from "./dimensions";

describe("subjective dimensions", () => {
  it("defines exactly the four subjective dimensions with anchors", () => {
    expect(SUBJECTIVE_DIMENSIONS.map((d) => d.key).sort()).toEqual([
      "confirmed_before_acting", "conversational_quality", "no_hallucination", "safety_escalation",
    ]);
    for (const d of SUBJECTIVE_DIMENSIONS) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.anchors).toMatch(/1\.0/);
    }
  });

  it("derives passed from the 0.7 threshold", () => {
    expect(PASS_THRESHOLD).toBe(0.7);
    expect(derivePassed("conversational_quality", 0.7)).toBe(true);
    expect(derivePassed("conversational_quality", 0.69)).toBe(false);
  });
});
