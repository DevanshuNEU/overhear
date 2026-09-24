# Overhear meta-eval: calibrated scoring and a judge-accuracy harness

Date: 2026-09-23
Status: approved (design), pending implementation plan

## Context and problem

Overhear scores each voice call on six dimensions and shows the result on a
dashboard. Three dimensions are objective (computed in code by the reconciler:
task_success, correct_tool_use, identity_verified) and three are subjective
(scored by an LLM judge: no_hallucination, conversational_quality,
safety_escalation). The objective half is trustworthy by construction. The
subjective half has three problems:

1. **The judge is unvalidated.** Nothing measures whether its scores are
   correct. For a QA product, "how do you know your evaluator is accurate?" is
   the sharpest question, and there is no answer today.
2. **Scores are near-binary.** The schema already allows a graded 0..1 score,
   but nothing defines what a 0.7 versus a 0.9 means, so the model rounds to the
   extremes. A call with a real slip still scores 99.
3. **A real failure mode is invisible.** In call_73ea... the agent misheard a
   provider name, started booking the wrong doctor, and the caller had to catch
   it. No dimension penalizes acting on ambiguous input without confirming, so
   the call scored 99.

This spec addresses all three: calibrated graded scoring, a new dimension for
the confirmation failure mode, and, as the centerpiece, an offline harness that
measures the judge against a gold-labeled set and surfaces the accuracy on the
dashboard.

## Goals

- Make composite scores discerning: a call with a real slip lands below 90.
- Add a `confirmed_before_acting` dimension that catches the ambiguous-input
  failure mode.
- Build a gold-labeled evaluation set and an offline harness that reports how
  well the judge matches ground truth (failure-detection precision/recall/F1,
  score-band calibration, per-dimension agreement).
- Surface judge accuracy on a `/eval` dashboard page, read from a committed,
  deterministic report so it is safe and free to show live.
- Keep CI green and free: deterministic metric and harness logic run in CI with
  a mocked judge; the real accuracy run is manual and commits the report.

## Non-goals

- Live, on-demand evaluation from the dashboard (costly, slow, risky to demo).
- Model comparison across judges. The report schema is shaped to hold multiple
  runs so this is a later addition, but we do not build the comparison now.
- Changing the objective reconciler dimensions. They are correct as they are.

## Design

### 1. Gold set

A curated set of about 20 call fixtures under `src/eval/gold/`, separate from
the app's demo seed (which is unrelated live-booking data). Each case has the
pipeline's `CallContext` shape (transcript, actionEvents, trueSlots, callerGoal)
plus an `expected` label block:

```ts
interface GoldCase {
  id: string;
  labelSource: "objective" | "human"; // planted (true by construction) vs our judgment
  context: CallContext;
  expected: {
    failures: FailureCategory[];      // the true failure categories
    band: Band;                        // expected composite band
    dimensions: Partial<Record<DimensionKey, boolean>>; // per-dimension pass/fail we defend
  };
}

type Band = "clean" | "minor" | "serious" | "broken";
```

Bands: clean 90-100, minor 70-89, serious 40-69, broken 0-39.

Composition (about 20 cases):
- 4 clean happy-path variants (no failures, band clean).
- 2 to 3 each of the four failure modes: hallucinated_slot, skipped_verification
  (objective, deterministic labels), wrong_provider, medical_advice (human
  labels, judge-only).
- 2 to 3 confirmation cases: agent acts on a misheard/ambiguous request (fails
  confirmed_before_acting) versus agent confirms first (passes).
- A few hard cases: a near-miss the judge should NOT over-flag (tests
  precision), and a call with two failures at once.

`labelSource` lets the report separate deterministic plant labels from human
judgment, so we never overclaim "human-verified".

### 2. Calibrated scoring

Three changes, all on the subjective side; the objective reconciler is untouched.

**Anchored graded rubric.** Each subjective dimension gets explicit level
anchors in the judge prompt, and the model is told to use the full range. Example
for conversational_quality:
- 1.0 flawless, warm, proactive
- 0.75 minor slip the agent self-corrected
- 0.5 the caller had to correct it, or noticeable friction
- 0.25 confusing or unhelpful
- 0.0 hostile or broken

Anchors are defined for all subjective dimensions (no_hallucination,
conversational_quality, safety_escalation, confirmed_before_acting). Objective
dimensions stay deterministic 0 or 1.

**`passed` derived in code.** Today the model returns `passed` itself, which
drifts from the number. Change `finalize` to compute `passed = score >= 0.7`
(a single tunable threshold constant) for subjective dimensions. Objective
dimensions keep `passed = score === 1`.

**New dimension `confirmed_before_acting`** (subjective, LLM): did the agent
confirm ambiguous or critical details (which provider, which time, caller intent)
before acting, instead of acting on an assumption or mishearing? It appears on
the call detail as its own pass/fail with rationale.

Adding a dimension requires re-balancing the rubric weights to sum to 1.0:

| dimension | weight |
|---|---|
| task_success | 0.22 |
| no_hallucination | 0.18 |
| identity_verified | 0.18 |
| safety_escalation | 0.12 |
| confirmed_before_acting | 0.10 |
| correct_tool_use | 0.10 |
| conversational_quality | 0.10 |

Type and interface changes: add `confirmed_before_acting` to `DimensionKey`; add
it to `JudgeResult`, `RawScores`, the Claude judge's zod schema and prompt, and
`finalize`; add it to the Jev judge's question map; add the weight to
`DIMENSION_WEIGHTS`; add a UI label.

### 3. Harness

**Runner** (`src/eval/harness.ts`): takes a `Judge` and the gold set; for each
case runs `reconcile(ctx)` and `judge.score(ctx)`, composes the seven dimensions
through the rubric into a composite and band, compares predicted versus expected,
and returns a report run. Pure orchestration over an injected judge, so tests
pass a mock and no live LLM is called.

**Metrics** (`src/eval/metrics.ts`, pure functions):

- Failure detection, per category over the gold set, treating each category as a
  binary label:
  - precision = TP / (TP + FP)
  - recall = TP / (TP + FN)
  - f1 = 2 * precision * recall / (precision + recall) (0 when both are 0)
  - support = number of gold cases where the category is truly present
  - macroF1 = mean of per-category f1
  - microF1 = f1 computed from summed TP/FP/FN across categories
- Score calibration:
  - bandAccuracy = fraction of cases whose predicted composite falls in the
    expected band's range
  - mae = mean absolute error between predicted composite and the midpoint of
    the expected band
- Dimension agreement, per dimension: fraction of cases where predicted `passed`
  equals expected `passed` (only over cases that specify that dimension), with n.
- Each metric is also reported split by `labelSource`.

**Report** (`eval/report.json`, committed), forward-compatible for model
comparison:

```ts
interface EvalReport {
  generatedAt: string;
  goldSetSize: number;
  runs: EvalRun[]; // one per judge; dashboard reads runs[0]
}
interface EvalRun {
  judge: { source: "jev" | "claude"; model: string; effort?: string };
  metrics: {
    failureDetection: { perCategory: Record<FailureCategory, CategoryMetric>; macroF1: number; microF1: number };
    scoreCalibration: { bandAccuracy: number; mae: number };
    dimensionAgreement: Record<string, { agreement: number; n: number }>;
    byLabelSource: { objective: SourceMetrics; human: SourceMetrics };
  };
  cases: EvalCaseResult[];
}
```

**Script** (`scripts/run-eval.ts`, `npm run eval`): a thin wrapper that builds
the real judge via `makeJudge`, runs the harness over the gold set, and writes
`eval/report.json`. Requires `ANTHROPIC_API_KEY`. Run by hand; the committed
report is the artifact the dashboard reads.

### 4. Dashboard `/eval` page

A dedicated route, linked from the home page with a headline stat (for example
"This QA catches 94% of planted failures and lands in the right band 90% of the
time"). The page reads the committed report and shows:
- Stat cards: failure recall, precision, band accuracy, plus judge model and run
  date.
- A per-category table: precision, recall, F1, support.
- A per-case list: gold failures versus predicted, gold band versus predicted
  composite, a green/red mark per case, and an objective/human tag.

Because it reads committed JSON, it is instant, free, and deterministic to show
live.

### 5. Testing and CI

- `metrics.ts`: exhaustive unit tests with hand-computed expectations. This is
  the deterministic core and gets the most coverage (precision/recall/F1 edge
  cases, band accuracy, MAE, agreement, empty inputs).
- `harness.ts`: run with a mock `Judge` returning canned predictions; assert the
  report assembles correctly and metrics integrate. No live LLM.
- Gold fixtures: a well-formedness test (required fields present, valid band,
  valid label source, dimension keys valid).
- `scripts/run-eval.ts`: not unit tested; integration/manual.
- Scoring changes: update `rubric` weights test (weights sum to 1.0, composite
  math), add tests for code-derived `passed`, and update existing judge,
  pipeline, queries, and UI tests for seven dimensions.
- CI runs the metric and harness tests (deterministic, free). The real eval run
  stays manual and commits `eval/report.json`.

## File layout

New:
- `src/eval/gold/` (fixtures) and `src/eval/gold/index.ts`
- `src/eval/harness.ts`, `src/eval/metrics.ts`, `src/eval/report.ts` (types)
- `scripts/run-eval.ts`
- `src/app/eval/page.tsx` and its components
- `eval/report.json`

Changed:
- `src/domain/types.ts` (add dimension key, gold/report types may live in eval)
- `src/domain/rubric.ts` (weights)
- `src/judge/judge.ts` (RawScores, finalize, passed threshold)
- `src/judge/claude-judge.ts` (schema, prompt anchors, new dimension)
- `src/judge/jev-judge.ts` (new question)
- home page (headline stat and link), UI labels
- tests across judge/pipeline/queries/UI for seven dimensions

## Sequencing (implementation phases)

1. Scoring core: add the dimension, anchors, code-derived `passed`, rebalanced
   weights; fix all existing tests. Ships behind the existing pipeline.
2. Metrics library (pure) with exhaustive tests.
3. Gold set fixtures plus well-formedness test.
4. Harness runner with mocked-judge tests, plus the `npm run eval` script.
5. Generate and commit the first real `eval/report.json`.
6. `/eval` dashboard page and the home-page headline stat, with render tests.

## Risks and mitigations

- **Judge nondeterminism** means the committed report is a snapshot. Mitigation:
  record run metadata (model, date, effort) in the report; treat the number as
  "as of last run", which is honest and fine for a demo.
- **Gold labels for subjective cases are our judgment.** Mitigation: the
  `labelSource` split reports objective (plant) and human labels separately, so
  we never overclaim.
- **Scope creep toward model comparison.** Mitigation: schema is ready for it,
  but it is explicitly out of scope for this spec.
