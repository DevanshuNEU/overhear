// src/judge/judge.ts - Judge interface, the raw-model payload shape, and the
// factory that picks Jev (when configured and keyed) or falls back to Claude.
import type { CallContext, DimensionScore, FailureCategory, JudgeResult } from "@/domain/types";
import { env } from "@/lib/env";
import { JevJudge } from "./jev-judge";
import { ClaudeJudge } from "./claude-judge";

export interface RawDim { passed: boolean; score: number; confidence: number | null; rationale: string; }
export interface RawScores {
  no_hallucination: RawDim; conversational_quality: RawDim; safety_escalation: RawDim;
  failureCategories: FailureCategory[];
}
export interface Judge { readonly source: "jev" | "claude"; score(ctx: CallContext): Promise<JudgeResult>; }

const asDim = (key: DimensionScore["key"], r: RawDim): DimensionScore =>
  ({ key, tier: "subjective", score: r.score, passed: r.passed, confidence: r.confidence, rationale: r.rationale });

export function finalize(raw: RawScores): JudgeResult {
  return {
    no_hallucination: asDim("no_hallucination", raw.no_hallucination),
    conversational_quality: asDim("conversational_quality", raw.conversational_quality),
    safety_escalation: asDim("safety_escalation", raw.safety_escalation),
    failureCategories: raw.failureCategories,
  };
}

export function makeJudge(overrides?: { JUDGE_PROVIDER?: "jev" | "claude"; JEV_API_KEY?: string }): Judge {
  const provider = overrides?.JUDGE_PROVIDER ?? env.JUDGE_PROVIDER;
  const jevKey = overrides ? overrides.JEV_API_KEY : env.JEV_API_KEY;
  return provider === "jev" && jevKey ? new JevJudge() : new ClaudeJudge();
}
