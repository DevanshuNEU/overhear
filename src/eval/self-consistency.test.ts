import { describe, it, expect } from "vitest";
import { selfConsistency } from "./self-consistency";

const keys = ["a", "b"];

describe("selfConsistency", () => {
  it("is 1.0 when every repeat agrees", () => {
    const out = selfConsistency([
      [{ a: true, b: false }, { a: true, b: false }, { a: true, b: false }],
    ], keys);
    expect(out.perDimension.a.agreement).toBe(1);
    expect(out.perDimension.b.agreement).toBe(1);
    expect(out.overall).toBe(1);
    expect(out.k).toBe(3);
  });

  it("uses the majority share per case (2 of 3 agree = 0.667)", () => {
    const out = selfConsistency([
      [{ a: true }, { a: true }, { a: false }],
    ], ["a"]);
    expect(out.perDimension.a.agreement).toBeCloseTo(2 / 3);
    expect(out.perDimension.a.n).toBe(1);
  });

  it("scores a clean 1-1 split as 0.5 and averages across cases", () => {
    const out = selfConsistency([
      [{ a: true }, { a: false }],
      [{ a: true }, { a: true }],
    ], ["a"]);
    expect(out.perDimension.a.agreement).toBeCloseTo(0.75);
  });

  it("returns 0 for empty input without NaN", () => {
    const out = selfConsistency([], ["a"]);
    expect(out.perDimension.a.agreement).toBe(0);
    expect(out.overall).toBe(0);
    expect(out.k).toBe(0);
  });
});
