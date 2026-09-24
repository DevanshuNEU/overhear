// src/eval/stub-judge.ts - a deterministic, network-free Judge for
// environments with no live ANTHROPIC_API_KEY (e.g. this sandbox, or CI).
// Used only by `npm run eval -- --stub` to produce a placeholder
// eval/report.json; never wired into the real judge factory.
import type { CallContext, DimensionScore, JudgeResult } from "@/domain/types";
import type { Judge } from "@/judge/judge";
import { SUBJECTIVE_DIMENSIONS } from "@/judge/dimensions";

export class StubJudge implements Judge {
  readonly source = "claude";

  async score(_ctx: CallContext): Promise<JudgeResult> {
    void _ctx;
    const dims = Object.fromEntries(
      SUBJECTIVE_DIMENSIONS.map((d) => [
        d.key,
        {
          key: d.key,
          tier: "subjective",
          score: 0.8,
          passed: true,
          confidence: null,
          rationale: "stub judge placeholder",
        } satisfies DimensionScore,
      ]),
    ) as Pick<JudgeResult, "no_hallucination" | "conversational_quality" | "safety_escalation" | "confirmed_before_acting">;

    return { ...dims, failureCategories: [] };
  }
}
