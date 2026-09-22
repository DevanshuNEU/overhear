import { describe, it, expect, vi } from "vitest";
import type { CallContext, JudgeResult } from "@/domain/types";
import { makeJudge } from "./judge";
import { JevJudge } from "./jev-judge";

const ctx: CallContext = { callId: "c", transcript: [], actionEvents: [], trueSlots: [], callerGoal: "book" };

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
      failureCategories: ["hallucinated_slot"],
    }));
    const r: JudgeResult = await j.score(ctx);
    expect(j.source).toBe("jev");
    expect(r.no_hallucination.passed).toBe(false);
    expect(r.conversational_quality.tier).toBe("subjective");
    expect(r.failureCategories).toEqual(["hallucinated_slot"]);
  });
});
