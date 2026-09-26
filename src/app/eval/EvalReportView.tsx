// EvalReportView - presentational render of a committed EvalReport: how well
// the judge detects planted failures and lands calls in the right score band,
// against a gold-labeled set. No data fetching; the page component supplies
// the report. Every ratio here prints its raw counts beside it so the numbers
// stay checkable, not just trust-me percentages.
import type { EvalReport, CategoryMetric } from "@/eval/report";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DIMENSION_LABELS, FAILURE_LABELS } from "../components/labels";
import type { DimensionKey, FailureCategory } from "@/domain/types";
import { CategoryChart } from "./CategoryChart";

const DETERMINISTIC_DIMENSIONS: DimensionKey[] = ["task_success", "correct_tool_use", "identity_verified"];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function sumCounts(perCategory: Record<string, CategoryMetric>, key: "tp" | "fp" | "fn"): number {
  return Object.values(perCategory).reduce((total, metric) => total + metric[key], 0);
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="gap-1 rounded-xl px-4 py-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </Card>
  );
}

function MatchMark({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
        ok ? "border border-border text-foreground" : "bg-alarm-red/15 text-alarm-red"
      }`}
      aria-label={ok ? "match" : "mismatch"}
    >
      {ok ? "✓" : "✕"}
    </span>
  );
}

function failureList(failures: FailureCategory[]): string {
  if (failures.length === 0) return "none";
  return failures.map((f) => FAILURE_LABELS[f] ?? f).join(", ");
}

export function EvalReportView({ report }: { report: EvalReport }) {
  const run = report.runs[0];
  if (!run) {
    return <p className="text-sm text-muted-foreground">No eval runs in this report.</p>;
  }

  const { judge, metrics, cases } = run;
  const { perCategory } = metrics.failureDetection;
  const tp = sumCounts(perCategory, "tp");
  const fp = sumCounts(perCategory, "fp");
  const fn = sumCounts(perCategory, "fn");
  const recallDenominator = tp + fn;
  const precisionDenominator = tp + fp;
  const recall = recallDenominator === 0 ? 0 : tp / recallDenominator;
  const precision = precisionDenominator === 0 ? 0 : tp / precisionDenominator;
  const { bandAccuracy, inBand, total } = metrics.scoreCalibration;
  const generatedDate = new Date(report.generatedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const judgedDimensions = Object.keys(DIMENSION_LABELS).filter(
    (key) => !DETERMINISTIC_DIMENSIONS.includes(key as DimensionKey),
  ) as DimensionKey[];

  return (
    <div className="flex flex-col gap-8">
      {report.placeholder && (
        <div className="rounded-lg border border-alarm-amber/30 bg-alarm-amber/10 px-4 py-3 text-sm text-alarm-amber">
          Sample data: generated with a stub judge. Run <code className="font-mono">npm run eval</code> with a real
          ANTHROPIC_API_KEY to populate real numbers.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Failure recall" value={pct(recall)} detail={`${tp} of ${recallDenominator} planted failures caught`} />
        <StatCard label="Failure precision" value={pct(precision)} detail={`${tp} of ${precisionDenominator} flagged failures were real`} />
        <StatCard label="Band accuracy" value={pct(bandAccuracy)} detail={`${inBand} of ${total} calls in the right band`} />
        <StatCard label="Judge" value={judge.model} detail={`effort ${judge.effort ?? "default"}`} />
        <StatCard label="Generated" value={generatedDate} />
      </div>

      <p className="text-sm text-muted-foreground">
        {DETERMINISTIC_DIMENSIONS.map((key) => DIMENSION_LABELS[key]).join(", ")} are deterministic code checks;{" "}
        {judgedDimensions.map((key) => DIMENSION_LABELS[key]).join(", ")} are LLM-judged.
      </p>

      <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Honest limits: this is a small, mostly-synthetic gold set scored by a single labeler, and the failures are
        planted, so they are easier to catch than real ones. Treat these numbers as a floor on rigor, not a promise:
        real traffic will likely score lower. The next step is folding in real calls and a second labeler.
      </p>

      {metrics.selfConsistency && (
        <Card className="gap-2 px-4 py-4">
          <h2 className="text-lg font-medium">Self-consistency</h2>
          <p className="text-sm text-muted-foreground">
            How often the judge agrees with itself across {metrics.selfConsistency.k} runs of each call. Higher is more trustworthy.
          </p>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 pt-1 text-sm">
            <span className="text-2xl font-semibold tabular-nums text-alarm-amber">{pct(metrics.selfConsistency.overall)}</span>
            {Object.entries(metrics.selfConsistency.perDimension).map(([key, v]) => (
              <span key={key} className="text-muted-foreground">
                {DIMENSION_LABELS[key as DimensionKey] ?? key}:{" "}
                <span className="tabular-nums text-foreground">{pct(v.agreement)}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Failure detection by category</h2>
        <Card className="px-4 py-4">
          <CategoryChart perCategory={perCategory} />
        </Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="py-2 pr-4">Category</th>
                <th scope="col" className="py-2 pr-4">Precision</th>
                <th scope="col" className="py-2 pr-4">Recall</th>
                <th scope="col" className="py-2 pr-4">F1</th>
                <th scope="col" className="py-2 pr-4">Support</th>
                <th scope="col" className="py-2 pr-4">TP / FP / FN</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(perCategory).map(([category, metric]) => (
                <tr key={category} className="border-b border-border/60 text-foreground/90">
                  <td className="py-2 pr-4">{FAILURE_LABELS[category as FailureCategory] ?? category}</td>
                  <td className="py-2 pr-4 tabular-nums">{pct(metric.precision)}</td>
                  <td className="py-2 pr-4 tabular-nums">{pct(metric.recall)}</td>
                  <td className="py-2 pr-4 tabular-nums">{pct(metric.f1)}</td>
                  <td className="py-2 pr-4 tabular-nums">{metric.support}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {metric.tp} / {metric.fp} / {metric.fn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Gold vs predicted, per case</h2>
        <Card className="gap-0 overflow-hidden py-0">
          <div className="hidden grid-cols-[minmax(150px,0.8fr)_1.3fr_1fr] gap-4 border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Case</span>
            <span>Failures</span>
            <span>Band</span>
          </div>
          <ul className="divide-y divide-border/60">
            {cases.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[minmax(150px,0.8fr)_1.3fr_1fr] sm:items-start"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-xs text-muted-foreground">{c.id}</span>
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {c.labelSource}
                  </Badge>
                </div>

                <div className="flex items-start gap-2">
                  <MatchMark ok={c.failuresCorrect} />
                  {c.failuresCorrect ? (
                    <span className="text-muted-foreground">{failureList(c.gold.failures)}</span>
                  ) : (
                    <span className="text-alarm-red">
                      gold {failureList(c.gold.failures)} &rarr; {failureList(c.predicted.failures)}
                    </span>
                  )}
                </div>

                <div className="flex items-start gap-2">
                  <MatchMark ok={c.bandCorrect} />
                  {c.bandCorrect ? (
                    <span className="text-muted-foreground">
                      {c.gold.band} &middot; <span className="font-mono">{Math.round(c.predicted.composite)}</span>
                    </span>
                  ) : (
                    <span className="text-alarm-red">
                      {c.gold.band} &rarr; {c.predicted.band} &middot;{" "}
                      <span className="font-mono">{Math.round(c.predicted.composite)}</span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
