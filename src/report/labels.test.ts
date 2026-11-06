import { describe, expect, it } from "vitest";
import { PLATFORMS, RESULTS } from "./schema";
import {
  FIELD_STATUS_LABEL,
  PLATFORM_LABEL,
  RESULT_LABEL,
  TIER_LABEL,
  capitalize,
  formatDuration,
  rulesSummary,
} from "./labels";

describe("labels for the call detail screen", () => {
  it("names every platform and both evidence tiers", () => {
    for (const p of PLATFORMS) expect(PLATFORM_LABEL[p]).toBeTruthy();
    expect(TIER_LABEL[1]).toBe("Call record only");
    expect(TIER_LABEL[2]).toBe("Call record and backend log");
  });

  it("names every result and every field status", () => {
    for (const r of RESULTS) expect(RESULT_LABEL[r]).toBeTruthy();
    expect(Object.keys(FIELD_STATUS_LABEL).sort()).toEqual(["differs", "match", "not_spoken", "unresolved"]);
  });

  it("capitalizes the first letter only", () => {
    expect(capitalize("promises backed by the system")).toBe("Promises backed by the system");
    expect(capitalize("")).toBe("");
  });

  it("formats a length with units", () => {
    expect(formatDuration(161403)).toBe("2 min 41 s");
    expect(formatDuration(68001)).toBe("1 min 8 s");
    expect(formatDuration(42000)).toBe("42 s");
    expect(formatDuration(120000)).toBe("2 min");
  });

  describe("rulesSummary", () => {
    it("counts broken, unchecked and kept rules, worst first", () => {
      const r = (result: (typeof RESULTS)[number]) => ({ result });
      expect(rulesSummary([r("violated"), r("passed"), r("passed"), r("passed"), r("not_run")])).toBe("1 broken, 3 kept");
      expect(rulesSummary([r("unverified"), r("passed")])).toBe("1 couldn't check, 1 kept");
    });
    it("says plainly when no rule applied", () => {
      expect(rulesSummary([{ result: "not_applicable" }, { result: "not_run" }])).toBe("None applied");
    });
  });
});
