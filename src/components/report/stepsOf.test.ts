import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";
import { CONTRACT_IDS, GAP_CODES, type CallReport } from "@/report/schema";
import { GAP_NEXT_STEPS, NEXT_STEPS } from "@/report/labels";
import { nextStepsOf } from "./stepsOf";

describe("nextStepsOf", () => {
  it("gives a broken rule its steps, numbered in order", () => {
    const steps = nextStepsOf(failedSample);
    expect(steps).toEqual(NEXT_STEPS.transfer_kept);
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });

  it("gives a rule once, however many findings of it broke", () => {
    expect(failedSample.results.find((c) => c.contract === "transfer_kept")!.findings.filter((f) => f.result === "violated")).toHaveLength(2);
    expect(nextStepsOf(failedSample)).toHaveLength(NEXT_STEPS.transfer_kept.length);
  });

  it("gives nothing for a call with nothing broken", () => {
    expect(nextStepsOf(passedSample)).toEqual([]);
    expect(nextStepsOf(needsReviewSample)).toEqual([]);
  });

  it("gives nothing for gaps until a step is written for their code, and has a slot for it", () => {
    expect(nextStepsOf(unverifiedSample)).toEqual([]);
    const custom = { unknown_success: [{ lead: "Return a success field.", text: "Add it to the tool's response." }] };
    expect(nextStepsOf(unverifiedSample, custom)).toEqual(custom.unknown_success);
  });

  it("puts the steps for broken rules first, then for gaps, each in report order", () => {
    const broken: CallReport = { ...failedSample, evidence: { ...failedSample.evidence, gaps: unverifiedSample.evidence.gaps } };
    const gap = { lead: "G", text: "g" };
    expect(nextStepsOf(broken, { unknown_success: [gap] })).toEqual([...NEXT_STEPS.transfer_kept, gap]);
  });

  it("repeats a gap's steps once even when the same code is listed twice", () => {
    const twice: CallReport = { ...unverifiedSample, evidence: { ...unverifiedSample.evidence, gaps: [...unverifiedSample.evidence.gaps, ...unverifiedSample.evidence.gaps] } };
    const gap = { lead: "G", text: "g" };
    expect(nextStepsOf(twice, { unknown_success: [gap] })).toEqual([gap]);
  });
});

describe("the step words", () => {
  it("has concrete steps for every rule", () => {
    for (const c of CONTRACT_IDS) {
      expect(NEXT_STEPS[c].length).toBeGreaterThanOrEqual(2);
      for (const s of NEXT_STEPS[c]) {
        expect(s.lead.trim()).not.toBe("");
        expect(s.text.trim()).not.toBe("");
      }
    }
  });

  it("holds gap steps only for real gap codes, and none yet", () => {
    for (const code of Object.keys(GAP_NEXT_STEPS)) expect(GAP_CODES).toContain(code);
    expect(Object.keys(GAP_NEXT_STEPS)).toEqual([]);
  });

  it("has no dashes, and does not promise a regression test", () => {
    const all = [...Object.values(NEXT_STEPS).flat()].map((s) => `${s.lead} ${s.text}`).join(" ");
    expect(all).not.toMatch(/[–—]/);
    expect(all.toLowerCase()).not.toContain("regression");
  });
});
