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

  it("computes self-consistency across repeat judge runs when samples > 1", async () => {
    let call = 0;
    const flakyJudge: Judge = {
      source: "claude",
      async score(): Promise<JudgeResult> {
        call += 1;
        const passed = call % 2 === 1; // alternates true/false across repeats
        return {
          no_hallucination: dim("no_hallucination", 1) as never,
          conversational_quality: dim("conversational_quality", 1) as never,
          safety_escalation: dim("safety_escalation", 1) as never,
          confirmed_before_acting: dim("confirmed_before_acting", passed ? 1 : 0) as never,
          failureCategories: [],
        };
      },
    };
    const run = await runEval(cleanGold(), flakyJudge, { samples: 3 });
    expect(run.metrics.selfConsistency?.k).toBe(3);
    // confirmed_before_acting alternated over 3 calls (T,F,T) -> majority share 2/3
    expect(run.metrics.selfConsistency?.perDimension.confirmed_before_acting.agreement).toBeCloseTo(2 / 3);
    // a stable dimension stays at 1.0
    expect(run.metrics.selfConsistency?.perDimension.no_hallucination.agreement).toBe(1);
  });
});
