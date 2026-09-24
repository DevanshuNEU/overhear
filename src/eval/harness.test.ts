import { describe, it, expect } from "vitest";
import { runEval } from "./harness";
import { goldCase } from "./gold/build";
import type { Judge } from "@/judge/judge";
import type { CallContext, JudgeResult } from "@/domain/types";

const dim = (key: string, score: number) => ({ key, tier: "subjective" as const, score, passed: score >= 0.7, confidence: null, rationale: "" });
const perfectResult: JudgeResult = {
  no_hallucination: dim("no_hallucination", 1) as never,
  conversational_quality: dim("conversational_quality", 1) as never,
  safety_escalation: dim("safety_escalation", 1) as never,
  confirmed_before_acting: dim("confirmed_before_acting", 1) as never,
  failureCategories: [],
};
const perfectJudge: Judge = {
  source: "claude",
  async score(_ctx: CallContext): Promise<JudgeResult> {
    return perfectResult;
  },
};
const perfectJevJudge: Judge = {
  source: "jev",
  async score(_ctx: CallContext): Promise<JudgeResult> {
    return perfectResult;
  },
};

const cleanGold = () => [goldCase({
  id: "g1", labelSource: "objective",
  actionEvents: [
    { id: "e1", callId: "g1", tool: "verify_patient", args: {}, result: { verified: true }, ok: true, ts: "2026-01-01T00:00:00Z" },
    { id: "e2", callId: "g1", tool: "book_appointment", args: {}, result: { ok: true }, ok: true, ts: "2026-01-01T00:00:01Z" },
  ],
  lines: [{ role: "user", content: "book please" }, { role: "agent", content: "done" }],
  failures: [], band: "clean",
})];

describe("runEval", () => {
  it("scores each gold case and reports metrics for a perfect clean call", async () => {
    const run = await runEval(cleanGold(), perfectJudge);
    expect(run.cases).toHaveLength(1);
    expect(run.cases[0].predicted.band).toBe("clean");
    expect(run.cases[0].bandCorrect).toBe(true);
    expect(run.metrics.scoreCalibration.bandAccuracy).toBe(1);
    expect(run.judge).toEqual({ source: "claude", model: "claude-sonnet-5", effort: "low" });
  });

  it("derives the model from the injected judge's source", async () => {
    const run = await runEval(cleanGold(), perfectJevJudge);
    expect(run.judge).toEqual({ source: "jev", model: "jev-latest", effort: "low" });
  });
});
