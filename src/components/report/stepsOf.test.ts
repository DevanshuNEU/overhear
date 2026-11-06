import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";
import { CONTRACT_IDS, GAP_CODES, type CallReport } from "@/report/schema";
import { GAP_NEXT_STEPS, NEXT_STEPS, REASON_NEXT_STEPS } from "@/report/labels";
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

  it("lists the steps of two broken rules in the order the report holds them", () => {
    const broken = (c: (typeof failedSample.results)[number]) => ({ ...c, result: "violated" as const });
    const two: CallReport = {
      ...failedSample,
      results: failedSample.results.map((c) => (c.contract === "promise_backed" ? broken(c) : c)),
    };
    expect(nextStepsOf(two)).toEqual([...NEXT_STEPS.promise_backed, ...NEXT_STEPS.transfer_kept]);
  });

  it("gives steps for the broken rule and none for a rule that could not be checked beside it", () => {
    const mixed: CallReport = {
      ...failedSample,
      results: failedSample.results.map((c) => (c.contract === "promise_backed" ? { ...c, result: "unverified" as const } : c)),
    };
    expect(nextStepsOf(mixed)).toEqual(NEXT_STEPS.transfer_kept);
  });

  it("gives nothing for a passed call", () => {
    expect(nextStepsOf(passedSample)).toEqual([]);
  });

  it("gives a review reason its step: the check for a request that went unanswered", () => {
    expect(needsReviewSample.reasons[0].kind).toBe("unanswered_request");
    expect(nextStepsOf(needsReviewSample)).toEqual(REASON_NEXT_STEPS.unanswered_request);
    expect(REASON_NEXT_STEPS.unanswered_request!.length).toBeGreaterThanOrEqual(1);
  });

  it("gives a reason kind once however many reasons of that kind there are, and nothing for a deferral yet", () => {
    const twice: CallReport = { ...needsReviewSample, reasons: [needsReviewSample.reasons[0], needsReviewSample.reasons[0]] };
    expect(nextStepsOf(twice)).toEqual(REASON_NEXT_STEPS.unanswered_request);
    const deferral: CallReport = { ...needsReviewSample, reasons: [{ ...needsReviewSample.reasons[0], kind: "deferral" }] };
    expect(nextStepsOf(deferral)).toEqual([]);
    expect(REASON_NEXT_STEPS.deferral).toBeUndefined();
  });

  it("has a slot for a reason kind's steps, shown after the steps for broken rules and before gaps", () => {
    const gap = { lead: "G", text: "g" };
    const reason = { lead: "R", text: "r" };
    const report: CallReport = { ...needsReviewSample, evidence: { ...needsReviewSample.evidence, gaps: unverifiedSample.evidence.gaps } };
    expect(nextStepsOf(report, { unknown_success: [gap] }, { unanswered_request: [reason] })).toEqual([reason, gap]);
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

  it("holds reason steps only for reasons that name something, never for an unchecked rule", () => {
    for (const kind of Object.keys(REASON_NEXT_STEPS)) expect(["deferral", "unanswered_request"]).toContain(kind);
  });

  it("holds gap steps only for real gap codes, and none yet", () => {
    for (const code of Object.keys(GAP_NEXT_STEPS)) expect(GAP_CODES).toContain(code);
    expect(Object.keys(GAP_NEXT_STEPS)).toEqual([]);
  });

  it("states checks, not the engine's reading as fact, and does not tell the reader to change what it cannot know about", () => {
    const text = (c: keyof typeof NEXT_STEPS) => NEXT_STEPS[c].map((s) => `${s.lead} ${s.text}`).join(" ");
    // A broken transfer can rest on a tool call read aloud, so it cannot say what the agent claimed or that "none" was called.
    expect(text("transfer_kept")).not.toMatch(/said it without|none was called/);
    expect(text("transfer_kept")).toContain("after the claim");
    // The prompt step reads as one check: call the tool before saying it, or do not offer transfers.
    expect(text("transfer_kept")).toContain("It should call the transfer tool before it says it is transferring, or not offer transfers at all.");
    // A kept promise needs a call that backs it, not any successful call.
    expect(text("promise_backed")).toContain("backs the promise");
    // An identity check can be missing or can fail.
    expect(text("verified_before_change")).toContain("made and succeeded");
    // The request is the engine's reading, and may be wrong.
    expect(text("committed_matches_request")).toContain("engine read");
    // Not every finding has a table.
    expect(text("spoken_matches_committed")).toContain("Where there is a table");
    // Leads ask for a check; they do not order a remedy.
    for (const c of CONTRACT_IDS) for (const s of NEXT_STEPS[c]) expect(s.lead).not.toMatch(/^(Change|Make) /);
  });

  it("has no dashes, and does not promise a regression test", () => {
    const all = [...Object.values(NEXT_STEPS).flat(), ...Object.values(REASON_NEXT_STEPS).flat()].map((s) => `${s.lead} ${s.text}`).join(" ");
    expect(all).not.toMatch(/[\u2013\u2014]/);
    expect(all.toLowerCase()).not.toContain("regression");
  });
});
