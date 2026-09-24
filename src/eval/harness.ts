import type { DimensionScore, FailureCategory, JudgeResult } from "@/domain/types";
import { reconcile } from "@/domain/reconciler";
import { composite, DIMENSION_WEIGHTS } from "@/domain/rubric";
import type { Judge } from "@/judge/judge";
import { bandOf, failureDetection, scoreCalibration, dimensionAgreement } from "./metrics";
import { selfConsistency } from "./self-consistency";
import { SUBJECTIVE_DIMENSIONS } from "@/judge/dimensions";
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

export async function runEval(
  gold: GoldCase[],
  judge: Judge,
  opts: { samples?: number } = {},
): Promise<EvalRun> {
  const samples = Math.max(1, opts.samples ?? 1);
  const subjectiveKeys = SUBJECTIVE_DIMENSIONS.map((d) => d.key);
  const scored = [] as { c: GoldCase; dims: DimensionScore[]; jr: JudgeResult; comp: number }[];
  // For self-consistency: the subjective pass/fail verdicts of each repeat run.
  const caseSamples: Record<string, boolean>[][] = [];

  const subjectiveVerdicts = (jr: JudgeResult): Record<string, boolean> =>
    Object.fromEntries(subjectiveKeys.map((k) => [k, (jr as unknown as Record<string, DimensionScore>)[k].passed]));

  for (const c of gold) {
    const rec = reconcile(c.context);
    const jr = await judge.score(c.context);
    const dims: DimensionScore[] = [
      rec.task_success, rec.correct_tool_use, rec.identity_verified,
      jr.no_hallucination, jr.conversational_quality, jr.safety_escalation, jr.confirmed_before_acting,
    ];
    scored.push({ c, dims, jr, comp: composite(dims) });

    if (samples > 1) {
      const perCase = [subjectiveVerdicts(jr)];
      for (let s = 1; s < samples; s++) {
        perCase.push(subjectiveVerdicts(await judge.score(c.context)));
      }
      caseSamples.push(perCase);
    }
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

  // Built once: the pair set is the same for every dimension key, only the key
  // dimensionAgreement reads off it changes.
  const pairs = scored.map(({ c, dims }) => ({
    predicted: Object.fromEntries(dims.map((d) => [d.key, d.passed])),
    expected: c.expected.dimensions as Record<string, boolean | undefined>,
  }));
  const agreement: Record<string, { agreement: number; matches: number; n: number }> = {};
  for (const dimKey of Object.keys(DIMENSION_WEIGHTS)) {
    agreement[dimKey] = dimensionAgreement(pairs, dimKey);
  }

  return {
    judge: { source: judge.source, model: MODEL_BY_SOURCE[judge.source], effort: "low" },
    metrics: {
      ...sourceMetrics(rows),
      dimensionAgreement: agreement,
      byLabelSource: {
        objective: sourceMetrics(rows.filter((r) => r.labelSource === "objective")),
        human: sourceMetrics(rows.filter((r) => r.labelSource === "human")),
      },
      ...(samples > 1 ? { selfConsistency: selfConsistency(caseSamples, subjectiveKeys) } : {}),
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
