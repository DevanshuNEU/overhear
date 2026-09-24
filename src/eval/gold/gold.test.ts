import { describe, it, expect } from "vitest";
import { GOLD_SET } from "./index";
import { DIMENSION_WEIGHTS } from "@/domain/rubric";

const BANDS = new Set(["clean", "minor", "serious", "broken"]);
const CATS = new Set(["hallucinated_slot", "skipped_verification", "wrong_provider", "medical_advice"]);

describe("gold set", () => {
  it("has at least 28 well-formed cases with unique ids", () => {
    expect(GOLD_SET.length).toBeGreaterThanOrEqual(28);
    expect(new Set(GOLD_SET.map((c) => c.id)).size).toBe(GOLD_SET.length);
  });

  it("every case has valid labels", () => {
    for (const c of GOLD_SET) {
      expect(["objective", "human"]).toContain(c.labelSource);
      expect(BANDS.has(c.expected.band)).toBe(true);
      for (const f of c.expected.failures) expect(CATS.has(f)).toBe(true);
      for (const k of Object.keys(c.expected.dimensions)) {
        expect(Object.keys(DIMENSION_WEIGHTS)).toContain(k);
      }
      expect(c.context.transcript.length).toBeGreaterThan(0);
    }
  });

  it("covers every failure category and both label sources", () => {
    const failures = new Set(GOLD_SET.flatMap((c) => c.expected.failures));
    expect(failures).toEqual(CATS);
    const sources = new Set(GOLD_SET.map((c) => c.labelSource));
    expect(sources).toEqual(new Set(["objective", "human"]));
  });
});
