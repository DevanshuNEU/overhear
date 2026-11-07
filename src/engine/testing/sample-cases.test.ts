// @vitest-environment node
import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import type { Item } from "@/report/schema";
import { fromRetell } from "../adapters/retell";
import { EvalCaseSchema } from "../eval/case";
import { m1View } from "./build";
import { sampleCases } from "./sample-cases";
import { toRetell } from "./retell";

const byId = Object.fromEntries(sampleCases().map((c) => [c.id, c]));
const SAMPLES = [
  ["sample-failed", failedSample],
  ["sample-needs-review", needsReviewSample],
  ["sample-passed", passedSample],
] as const;

describe("sampleCases", () => {
  it("makes one valid case per sample", () => {
    expect(Object.keys(byId)).toEqual(["sample-failed", "sample-needs-review", "sample-passed"]);
    for (const c of Object.values(byId)) expect(EvalCaseSchema.safeParse(c).success).toBe(true);
  });

  it("labels them as the samples: real, constructed, locked", () => {
    for (const c of Object.values(byId)) {
      expect(c).toMatchObject({ source: "real", independent: false, platform: "retell", locked: true, label: { by: "sample", at: "2026-11-06" } });
      expect(c.label.note).toBeTruthy();
    }
  });

  it("builds each record from the sample's evidence with toRetell", () => {
    expect(byId["sample-failed"].record).toEqual(toRetell(failedSample.evidence));
    expect(byId["sample-passed"].record).toEqual(toRetell(passedSample.evidence));
    expect(byId["sample-needs-review"].record).toEqual(toRetell(needsReviewSample.evidence));
  });

  it.each(SAMPLES)("the Retell adapter reads the %s record back to the sample's evidence, tool_result.ok aside", (id, sample) => {
    const adapted = fromRetell(byId[id].record);
    expect(adapted.kind).toBe("evidence");
    const okNull = (items: Item[]) => items.map((it) => (it.kind === "tool_result" ? { ...it, ok: null } : it));
    if (adapted.kind === "evidence") expect(okNull(adapted.evidence.items)).toEqual(okNull(sample.evidence.items));
  });

  it("expects the failed sample's M1 verdict and results, and the two transfer claims cited", () => {
    expect(byId["sample-failed"].expect).toEqual({
      verdict: "failed",
      contracts: { promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "violated", committed_matches_request: "not_run" },
      mustCite: [{ contract: "transfer_kept", seqs: [25, 27] }],
    });
  });

  it("expects the passed sample's M1 verdict and results", () => {
    expect(byId["sample-passed"].expect).toEqual({
      verdict: "passed",
      contracts: { promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "not_applicable", committed_matches_request: "not_run" },
    });
  });

  it("expects needs_review for the needs-review sample: the agent deferred", () => {
    expect(byId["sample-needs-review"].expect).toEqual({
      verdict: "needs_review",
      contracts: { promise_backed: "not_applicable", spoken_matches_committed: "not_applicable", transfer_kept: "not_applicable", committed_matches_request: "not_run" },
    });
  });

  // The case rests on two reasons: a deferral that code finds, and a request a model found. If the sample
  // changes, this fails and the expectation above is looked at again.
  it("the needs-review case rests on a deferral and the model-found request, with no code-run contract applying", () => {
    const view = m1View(needsReviewSample);
    expect(view.verdict).toBe("needs_review");
    expect(view.requestSource).toBe("llm");
    expect(view.reasons.map((r) => r.kind)).toEqual(["unanswered_request", "deferral"]);
    expect(view.results.filter((r) => r.contract !== "committed_matches_request").map((r) => r.result)).toEqual([
      "not_applicable",
      "not_applicable",
      "not_applicable",
    ]);
    expect(view.detections.map((d) => d.cls)).toContain("deferral");
  });

  it("follows m1View for the samples M1 can reproduce", () => {
    expect(byId["sample-failed"].expect.verdict).toBe(m1View(failedSample).verdict);
    expect(byId["sample-passed"].expect.verdict).toBe(m1View(passedSample).verdict);
  });
});
