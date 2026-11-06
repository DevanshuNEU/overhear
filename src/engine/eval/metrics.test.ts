// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ContractId, Result, Verdict } from "@/report/schema";
import type { ActualResult, ActualVerdict, CaseResult } from "./run";
import { engineMetrics, groupMetrics, rate, wilson } from "./metrics";

/** A case result with only what the metrics read; each test sets the rest. */
function res(
  expected: Verdict,
  actual: ActualVerdict,
  opts: {
    independent?: boolean;
    labels?: Partial<Record<ContractId, Result>>;
    results?: Partial<Record<ContractId, Result>>;
    pass?: boolean;
    source?: CaseResult["source"];
  } = {},
): CaseResult {
  const isReport = actual !== "error" && actual !== "no_content";
  const results = isReport ? (opts.results ?? {}) : {};
  const contracts = Object.entries(opts.labels ?? {}).map(([contract, exp]) => {
    const act: ActualResult = isReport ? (results[contract as ContractId] ?? "missing") : "no_report";
    return { contract: contract as ContractId, expected: exp, actual: act, agree: act === exp };
  });
  return {
    id: "x",
    source: opts.source ?? "real",
    independent: opts.independent ?? false,
    locked: false,
    outcome: isReport ? "report" : actual,
    message: actual === "error" ? "boom" : null,
    expected,
    actual,
    verdictMatch: expected === actual,
    contracts,
    results,
    mustCite: [],
    pass: opts.pass ?? (isReport && expected === actual),
  };
}

describe("wilson", () => {
  it("gives about [0.71, 0.85] for 97 of 123", () => {
    const [lo, hi] = wilson(97, 123);
    expect(lo).toBeCloseTo(0.71, 2);
    expect(hi).toBeCloseTo(0.85, 2);
  });

  it("stays inside 0 and 1 at the edges", () => {
    expect(wilson(0, 10)[0]).toBe(0);
    expect(wilson(0, 10)[1]).toBeCloseTo(0.278, 3);
    expect(wilson(10, 10)[0]).toBeCloseTo(0.722, 3);
    expect(wilson(10, 10)[1]).toBe(1);
  });

  it("refuses n = 0: there is no interval without data", () => {
    expect(() => wilson(0, 0)).toThrow(/n/);
  });
});

describe("rate", () => {
  it("carries k, n, the value and the interval", () => {
    expect(rate(1, 4)).toEqual({ k: 1, n: 4, value: 0.25, ci: [expect.any(Number), expect.any(Number)] });
  });

  it("is no data at n = 0, never 0% or 100%", () => {
    expect(rate(0, 0)).toEqual({ k: 0, n: 0, value: null, ci: null });
  });

  it("rounds to four places so the committed report diffs cleanly", () => {
    expect(rate(1, 3).value).toBe(0.3333);
  });
});

describe("groupMetrics: the verdict", () => {
  const results = [
    res("failed", "failed"), // caught
    res("failed", "passed"), // missed
    res("failed", "error"), // no report: a miss for recall, wrong for accuracy
    res("passed", "failed"), // false failed
    res("passed", "passed"),
    res("passed", "error"), // no report: left out of the false-failed rate
    res("needs_review", "needs_review"),
  ];
  const m = groupMetrics(results);

  it("counts n, outcomes and sources", () => {
    expect(m.n).toBe(7);
    expect(m.outcomes).toEqual({ report: 5, no_content: 0, error: 2 });
    expect(m.sources).toEqual({ real: 7, mutation: 0, external: 0 });
  });

  it("fills the confusion table, expected by actual, with every row and column present", () => {
    expect(m.overall.confusion.failed).toEqual({ failed: 1, needs_review: 0, passed: 1, no_content: 0, error: 1 });
    expect(m.overall.confusion.passed).toEqual({ failed: 1, needs_review: 0, passed: 1, no_content: 0, error: 1 });
    expect(m.overall.confusion.needs_review).toEqual({ failed: 0, needs_review: 1, passed: 0, no_content: 0, error: 0 });
  });

  it("counts a case with no report as wrong for accuracy", () => {
    expect(m.overall.verdictAccuracy).toMatchObject({ k: 3, n: 7 });
  });

  it("computes precision of failed over the cases the engine called failed", () => {
    expect(m.overall.failedPrecision).toMatchObject({ k: 1, n: 2, value: 0.5 });
  });

  it("computes recall of failed over the cases labeled failed, a case with no report counting as a miss", () => {
    expect(m.overall.failedRecall).toMatchObject({ k: 1, n: 3 });
  });

  it("computes the false-failed rate over normal calls the engine gave a verdict on", () => {
    expect(m.overall.falseFailedRate).toMatchObject({ k: 1, n: 2, value: 0.5 });
  });

  it("counts cases that pass every check", () => {
    expect(m.passing).toMatchObject({ k: 3, n: 7 });
  });
});

describe("groupMetrics: per contract", () => {
  const results = [
    res("failed", "failed", { labels: { transfer_kept: "violated" }, results: { transfer_kept: "violated" } }),
    res("failed", "passed", { labels: { transfer_kept: "violated" }, results: { transfer_kept: "not_applicable" } }),
    res("failed", "error", { labels: { transfer_kept: "violated" } }),
    res("passed", "failed", { labels: { transfer_kept: "passed" }, results: { transfer_kept: "violated" } }),
    // Labeled only for its verdict: no contract label, but a violated transfer_kept is still a false alarm.
    res("passed", "failed", { results: { transfer_kept: "violated" } }),
    res("passed", "passed", { results: { transfer_kept: "unverified", promise_backed: "passed" } }),
  ];
  const t = groupMetrics(results).contracts.transfer_kept;

  it("has n = the cases labeled for the contract", () => {
    expect(t.n).toBe(4);
  });

  it("fills the confusion table from labeled cases only", () => {
    expect(t.confusion.violated).toEqual({ violated: 1, passed: 0, unverified: 0, not_applicable: 1, not_run: 0, missing: 0, no_report: 1 });
    expect(t.confusion.passed).toMatchObject({ violated: 1 });
  });

  it("computes agreement, and precision and recall of violated, from labeled cases", () => {
    expect(t.agreement).toMatchObject({ k: 1, n: 4 });
    expect(t.violatedPrecision).toMatchObject({ k: 1, n: 2 });
    expect(t.violatedRecall).toMatchObject({ k: 1, n: 3 });
  });

  it("computes the false-violated rate over every normal call with a report, labeled for the contract or not", () => {
    expect(t.falseViolatedRate).toMatchObject({ k: 2, n: 3 });
  });

  it("computes the unverified rate over reports where the contract applied", () => {
    // Applied (violated, passed or unverified): violated, violated, violated, unverified. not_applicable is left out.
    expect(t.unverifiedRate).toMatchObject({ k: 1, n: 4 });
  });

  it("shows a contract nobody labeled as no data, not as 0% or 100%", () => {
    const v = groupMetrics(results).contracts.verified_before_change;
    expect(v.n).toBe(0);
    expect(v.agreement.value).toBeNull();
    expect(v.violatedPrecision.value).toBeNull();
    expect(v.violatedRecall.value).toBeNull();
  });

  it("has every contract", () => {
    expect(Object.keys(groupMetrics(results).contracts)).toEqual([
      "promise_backed",
      "verified_before_change",
      "spoken_matches_committed",
      "transfer_kept",
      "committed_matches_request",
    ]);
  });
});

describe("independent and constructed data", () => {
  it("are reported in separate groups", () => {
    const m = engineMetrics([res("failed", "failed", { independent: true }), res("passed", "passed"), res("passed", "failed")]);
    expect(m.independent.n).toBe(1);
    expect(m.independent.overall.verdictAccuracy).toMatchObject({ k: 1, n: 1 });
    expect(m.constructed.n).toBe(2);
    expect(m.constructed.overall.verdictAccuracy).toMatchObject({ k: 1, n: 2 });
  });

  it("are never pooled: groupMetrics refuses a mix", () => {
    expect(() => groupMetrics([res("failed", "failed", { independent: true }), res("passed", "passed")])).toThrow(/never pooled/);
  });

  it("an empty group is all no data", () => {
    const m = engineMetrics([res("passed", "passed")]).independent;
    expect(m.n).toBe(0);
    expect(m.overall.verdictAccuracy.value).toBeNull();
    expect(m.overall.falseFailedRate.value).toBeNull();
    expect(m.passing.value).toBeNull();
  });
});
