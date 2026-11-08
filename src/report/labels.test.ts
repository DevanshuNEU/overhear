import { describe, expect, it } from "vitest";
import { PLATFORMS, RESULTS } from "./schema";
import {
  FIELD_STATUS_LABEL,
  NO_CONTENT_LINE,
  NO_CONTENT_REASONS,
  NOT_A_RETELL_CALL,
  ruleCountLine,
  PLATFORM_LABEL,
  RESULT_LABEL,
  TIER_LABEL,
  capitalize,
  experienceChecked,
  experienceLine,
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

  it("counts rules that did not apply or were not checked", () => {
    expect(ruleCountLine("not_applicable", 1)).toBe("1 rule didn't apply");
    expect(ruleCountLine("not_applicable", 5)).toBe("5 rules didn't apply");
    expect(ruleCountLine("not_run", 1)).toBe("1 rule not checked");
    expect(ruleCountLine("not_run", 2)).toBe("2 rules not checked");
  });
});

describe("words for a call with no report", () => {
  it("has one plain sentence for every no_content reason", () => {
    expect(NO_CONTENT_REASONS).toEqual(["storage_stripped", "never_connected", "no_transcript"]);
    expect(Object.keys(NO_CONTENT_LINE).sort()).toEqual([...NO_CONTENT_REASONS].sort());
    for (const r of NO_CONTENT_REASONS) expect(NO_CONTENT_LINE[r]).toMatch(/^[A-Z].*\.$/);
    expect(new Set(Object.values(NO_CONTENT_LINE)).size).toBe(NO_CONTENT_REASONS.length);
  });

  it("says what a record that is not a Retell call is, and what to pass instead", () => {
    expect(NOT_A_RETELL_CALL.message).toMatch(/call_id/);
    expect(NOT_A_RETELL_CALL.fix).toMatch(/get-call/);
  });
});

describe("the call experience line", () => {
  it("counts the problems, or says none were found", () => {
    expect(experienceLine(0)).toBe("Call experience: no problems found");
    expect(experienceLine(1)).toBe("Call experience: 1 problem");
    expect(experienceLine(3)).toBe("Call experience: 3 problems");
  });

  it("names the checks that ran, in a sentence", () => {
    expect(experienceChecked(["agent_ends_call"])).toBe("Checked: the agent ends the call.");
    expect(experienceChecked(["agent_ends_call", "error_handled"])).toBe("Checked: the agent ends the call and errors handled well.");
    expect(experienceChecked(["agent_ends_call", "error_handled", "spoken_format"])).toBe("Checked: the agent ends the call, errors handled well and dates and times read naturally.");
  });
});
