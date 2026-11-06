// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CallReportSchema, EvidenceSchema } from "@/report/schema";
import { SAMPLE_REPORTS, failedSample } from "@/report/samples";
import { assertValidReport, ev, m1View } from "./build";

describe("m1View", () => {
  it("on the failed sample sets packs to scheduling, drops verified_before_change and leaves the other four results equal", () => {
    const view = m1View(failedSample);
    expect(view.policy.packs).toEqual(["scheduling"]);
    expect(view.results.map((r) => r.contract)).not.toContain("verified_before_change");
    expect(view.results).toEqual(failedSample.results.filter((r) => r.contract !== "verified_before_change"));
    expect(view.results).toHaveLength(4);
  });

  it("changes nothing else", () => {
    const view = m1View(failedSample);
    const { policy, results, ...rest } = view;
    const { policy: samplePolicy, results: _sampleResults, ...sampleRest } = failedSample;
    expect(rest).toEqual(sampleRest);
    expect({ ...policy, packs: samplePolicy.packs }).toEqual(samplePolicy);
    expect(results.length).toBe(_sampleResults.length - 1);
  });

  it("leaves the sample untouched", () => {
    const before = structuredClone(failedSample);
    m1View(failedSample);
    expect(failedSample).toEqual(before);
  });

  it.each(SAMPLE_REPORTS.map((r) => [r.verdict, r] as const))("output validates under CallReportSchema for the %s sample", (_v, sample) => {
    const parsed = CallReportSchema.safeParse(m1View(sample));
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });
});

describe("ev", () => {
  it("numbers items from 1", () => {
    const e = ev([
      { kind: "turn", role: "agent", text: "Hi.", startSec: null, interrupted: null },
      { kind: "tool_call", id: "t1", name: "book_appointment", args: {} },
      { kind: "tool_result", id: "t1", ok: null, platformOk: true, payload: {} },
    ]);
    expect(e.items.map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it("fills a valid Tier 1 evidence with ordered items and no call fields", () => {
    const e = ev([]);
    expect(e).toMatchObject({ callFields: {}, tier: 1, ordering: "sequence", callStartMs: null, gaps: [] });
    expect(EvidenceSchema.safeParse(e).success).toBe(true);
  });

  it("takes overrides", () => {
    const e = ev([], { ordering: "none", callId: "call_x" });
    expect(e.ordering).toBe("none");
    expect(e.callId).toBe("call_x");
  });
});

describe("assertValidReport", () => {
  it("returns a valid report", () => {
    expect(assertValidReport(failedSample)).toEqual(failedSample);
  });

  it("throws with the zod issues for an invalid one", () => {
    const bad = { ...structuredClone(failedSample), verdict: "passed" };
    expect(() => assertValidReport(bad)).toThrow(/verdict/);
  });
});
