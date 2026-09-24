import type { DimensionScore, FailureCategory, JudgeResult } from "@/domain/types";
import { reconcile } from "@/domain/reconciler";
import { composite, DIMENSION_WEIGHTS } from "@/domain/rubric";
import type { Judge } from "@/judge/judge";
import { bandOf, failureDetection, scoreCalibration, dimensionAgreement } from "./metrics";
import type { EvalRun, EvalReport, EvalCaseResult, SourceMetrics, Band } from "./report";
import type { GoldCase } from "./gold/build";

const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  "hallucinated_slot", "skipped_verification", "wrong_provider", "medical_advice",
];
const MODEL_BY_SOURCE: Record<Judge["source"], string> = { claude: "claude-sonnet-5", jev: "jev-latest" };

function sourceMetrics(rows: { predicted: FailureCategory[]; expected: FailureCategory[]; predictedComposite: number; expectedBand: Band }[]): SourceMetrics {
  return {
    failureDetection: failureDetection(rows, FAILURE_CATEGORIES),
    scoreCalibration: scoreCalibration(rows),
  };
}

export async function runEval(gold: GoldCase[], judge: Judge): Promise<EvalRun> {
  const scored = [] as { c: GoldCase; dims: DimensionScore[]; jr: JudgeResult; comp: number }[];
  for (const c of gold) {
    const rec = reconcile(c.context);
    const jr = await judge.score(c.context);
    const dims: DimensionScore[] = [
      rec.task_success, rec.correct_tool_use, rec.identity_verified,
      jr.no_hallucination, jr.conversational_quality, jr.safety_escalation, jr.confirmed_before_acting,
    ];
    scored.push({ c, dims, jr, comp: composite(dims) });
  }

  const cases: EvalCaseResult[] = scored.map(({ c, jr, comp }) => {
    const predictedFailures = jr.failureCategories;
    const predictedBand = bandOf(comp);
    const failuresCorrect = sameSet(predictedFailures, c.expected.failures);
    return {
      id: c.id, labelSource: c.labelSource,
      gold: { failures: c.expected.failures, band: c.expected.band },
      predicted: { failures: predictedFailures, composite: comp, band: predictedBand },
      failuresCorrect, bandCorrect: predictedBand === c.expected.band,
    };
  });

  const rows = scored.map(({ c, jr, comp }) => ({
    predicted: jr.failureCategories, expected: c.expected.failures,
    predictedComposite: comp, expectedBand: c.expected.band,
    labelSource: c.labelSource,
  }));

  const agreement: Record<string, { agreement: number; matches: number; n: number }> = {};
  for (const dimKey of Object.keys(DIMENSION_WEIGHTS)) {
    const pairs = scored.map(({ c, dims }) => ({
      predicted: Object.fromEntries(dims.map((d) => [d.key, d.passed])),
      expected: c.expected.dimensions as Record<string, boolean | undefined>,
    }));
    agreement[dimKey] = dimensionAgreement(pairs, dimKey);
  }

  return {
    judge: { source: judge.source, model: MODEL_BY_SOURCE[judge.source], temperature: 0 },
    metrics: {
      ...sourceMetrics(rows),
      dimensionAgreement: agreement,
      byLabelSource: {
        objective: sourceMetrics(rows.filter((r) => r.labelSource === "objective")),
        human: sourceMetrics(rows.filter((r) => r.labelSource === "human")),
      },
    },
    cases,
  };
}

export function buildReport(gold: GoldCase[], run: EvalRun): EvalReport {
  return {
    generatedAt: new Date().toISOString(),
    goldSetSize: gold.length,
    rubric: { weights: DIMENSION_WEIGHTS, dimensionKeys: Object.keys(DIMENSION_WEIGHTS) as EvalReport["rubric"]["dimensionKeys"] },
    runs: [run],
  };
}

function sameSet(a: FailureCategory[], b: FailureCategory[]): boolean {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}
