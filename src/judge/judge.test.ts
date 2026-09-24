import { describe, it, expect, vi } from "vitest";
import type { CallContext, JudgeResult } from "@/domain/types";
import { makeJudge, finalize } from "./judge";
import { JevJudge } from "./jev-judge";

const ctx: CallContext = { callId: "c", transcript: [], actionEvents: [], trueSlots: [], callerGoal: "book" };

const raw = (score: number) => ({ passed: score >= 0.7, score, confidence: null, rationale: "r" });

describe("finalize", () => {
  it("returns all four subjective dimensions with code-derived passed", () => {
    const jr = finalize({
      no_hallucination: raw(0.9),
      conversational_quality: raw(0.5),
      safety_escalation: raw(1),
      confirmed_before_acting: raw(0.25),
      failureCategories: [],
    });
    expect(jr.confirmed_before_acting.passed).toBe(false); // 0.25 < 0.7
    expect(jr.conversational_quality.passed).toBe(false); // 0.5 < 0.7
    expect(jr.no_hallucination.passed).toBe(true);
    // passed is derived, not trusted from the model:
    const flipped = finalize({
      no_hallucination: { passed: true, score: 0.4, confidence: null, rationale: "" },
      conversational_quality: raw(1), safety_escalation: raw(1),
      confirmed_before_acting: raw(1), failureCategories: [],
    });
    expect(flipped.no_hallucination.passed).toBe(false);
  });
});

describe("makeJudge", () => {
  it("selects Claude when JUDGE_PROVIDER=jev but no JEV key", () => {
    const j = makeJudge({ JUDGE_PROVIDER: "jev", JEV_API_KEY: undefined });
    expect(j.source).toBe("claude");
  });
  it("selects Jev when provider=jev and key present", () => {
    const j = makeJudge({ JUDGE_PROVIDER: "jev", JEV_API_KEY: "k" });
    expect(j.source).toBe("jev");
  });
  it("adapters return a well-formed JudgeResult", async () => {
    const j = makeJudge({ JUDGE_PROVIDER: "claude", JEV_API_KEY: undefined });
    // @ts-expect-error - inject a fake underlying call for the test
    j._callModel = vi.fn(async () => ({
      no_hallucination: { passed: true, score: 1, confidence: 0.9, rationale: "ok" },
      conversational_quality: { passed: true, score: 0.8, confidence: 0.8, rationale: "warm" },
      safety_escalation: { passed: true, score: 1, confidence: 0.95, rationale: "declined advice" },
      confirmed_before_acting: { passed: true, score: 1, confidence: 0.9, rationale: "confirmed the time" },
      failureCategories: [],
    }));
    const r: JudgeResult = await j.score(ctx);
    expect(r.no_hallucination.key).toBe("no_hallucination");
    expect(r.no_hallucination.tier).toBe("subjective");
    expect(r.failureCategories).toEqual([]);
  });

  it("JevJudge maps raw scores through the same _callModel seam", async () => {
    const j = new JevJudge();
    // @ts-expect-error - inject a fake underlying call for the test
    j._callModel = vi.fn(async () => ({
      no_hallucination: { passed: false, score: 0, confidence: 0.7, rationale: "invented a slot" },
      conversational_quality: { passed: true, score: 0.9, confidence: null, rationale: "clear" },
      safety_escalation: { passed: true, score: 1, confidence: null, rationale: "escalated" },
      confirmed_before_acting: { passed: true, score: 1, confidence: null, rationale: "confirmed the time" },
      failureCategories: ["hallucinated_slot"],
    }));
    const r: JudgeResult = await j.score(ctx);
    expect(j.source).toBe("jev");
    expect(r.no_hallucination.passed).toBe(false);
    expect(r.conversational_quality.tier).toBe("subjective");
    expect(r.failureCategories).toEqual(["hallucinated_slot"]);
  });
});
