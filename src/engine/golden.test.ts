// @vitest-environment node
// The goldens: the engine's report for each sample call equals the sample, under M1's scheduling pack
// (m1View in testing/build.ts). Each sample is checked twice: from its evidence (checkCall), and from the raw
// Retell record its evidence writes back to (analyzeRetellCall), which runs the adapter and the policy choice too.
// The samples were written by hand, so a mismatch is a question: fix the engine, fix the sample, or list it open.
import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { CallReportSchema, type CallReport } from "@/report/schema";
import { analyzeRetellCall } from "./analyze";
import { checkCall } from "./check";
import { detectAll } from "./detect-speech";
import { m1View } from "./testing/build";
import { toRetell } from "./testing/retell";

const opts = { tz: "UTC" };

/** The report analyzeRetellCall makes for a sample's record. Throws when it is not a report. */
function analyzed(sample: CallReport): CallReport {
  const out = analyzeRetellCall(toRetell(sample.evidence), opts);
  if (out.kind !== "report") throw new Error(`expected a report, got ${JSON.stringify(out)}`);
  return out.report;
}

describe("goldens", () => {
  it("failed sample: checkCall equals m1View(failed)", () => {
    expect(checkCall(failedSample.evidence, failedSample.policy, { ...opts, policySource: "preset" })).toEqual(m1View(failedSample));
  });

  it("passed sample: checkCall equals m1View(passed)", () => {
    expect(checkCall(passedSample.evidence, passedSample.policy, { ...opts, policySource: "preset" })).toEqual(m1View(passedSample));
  });

  it("failed sample: analyzeRetellCall(toRetell(evidence)) equals m1View(failed)", () => {
    expect(analyzed(failedSample)).toEqual(m1View(failedSample));
  });

  it("passed sample: analyzeRetellCall(toRetell(evidence)) equals m1View(passed)", () => {
    expect(analyzed(passedSample)).toEqual(m1View(passedSample));
  });

  // M1 has no request source, so it cannot find the unanswered request the sample's second reason rests on. The
  // sample's other reason, the deferral, is found by rule, so the call needs review for it. M2 owns the full golden.
  describe("needs-review sample", () => {
    const report = () => checkCall(needsReviewSample.evidence, needsReviewSample.policy, { ...opts, policySource: "preset" });

    it("evidence and detections equal the sample", () => {
      const r = report();
      expect(r.evidence).toEqual(needsReviewSample.evidence);
      expect(r.detections).toEqual(needsReviewSample.detections.filter((d) => d.source === "code"));
      expect(detectAll(needsReviewSample.evidence, Object.keys(needsReviewSample.policy.tools))).toEqual(needsReviewSample.detections);
    });

    it("is needs_review for the deferral, with the request not checked", () => {
      const r = CallReportSchema.parse(report());
      expect(r.verdict).toBe("needs_review");
      expect(r.notes).toEqual([]);
      expect(r.reasons).toEqual([
        { kind: "deferral", text: 'At 0:37 the agent said "Please try again shortly, or I can help once it’s back online". It put the request off.', seqs: [12] },
      ]);
      expect(r.headline).toBe("The agent deferred the caller's request instead of completing it.");
      expect(r.request).toBeNull();
      expect(r.requestSource).toBeNull();
      expect(r.results.find((c) => c.contract === "committed_matches_request")?.result).toBe("not_run");
    });

    it("differs from the sample only where M2's request source would change it", () => {
      const sample = m1View(needsReviewSample);
      const r = report();
      const m1 = (c: CallReport["results"][number]) => (c.contract === "committed_matches_request" ? { ...c, result: "not_run" as const } : c);
      expect(r.results).toEqual(sample.results.map(m1));
      expect({ ...r, reasons: [], request: null, requestSource: null }).toEqual({
        ...sample,
        results: sample.results.map(m1),
        reasons: [],
        request: null,
        requestSource: null,
        llmUsed: false,
      });
    });

    // The record's only tool call is a lookup that errored, which says nothing about whose agent this is (policyFor),
    // so the raw record gets an inferred policy and the demo preset is not used. Nothing in this call depends on the
    // policy, so the report is the same except for the policy it lists.
    it("through analyzeRetellCall gives the same report, under the policy inferred from the record", () => {
      const out = analyzed(needsReviewSample);
      expect(Object.keys(out.policy.tools)).toEqual(["check_availability"]);
      expect(out).toEqual({ ...report(), policy: out.policy });
    });
  });
});
