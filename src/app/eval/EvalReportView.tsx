// EvalReportView - presentational render of a committed EvalReport: how well
// the judge detects planted failures and lands calls in the right score band,
// against a gold-labeled set. No data fetching; the page component supplies
// the report. Every ratio here prints its raw counts beside it so the numbers
// stay checkable, not just trust-me percentages.
import type { EvalReport, CategoryMetric } from "@/eval/report";
import { DIMENSION_LABELS, FAILURE_LABELS } from "../components/labels";
import type { DimensionKey, FailureCategory } from "@/domain/types";

const DETERMINISTIC_DIMENSIONS: DimensionKey[] = ["task_success", "correct_tool_use", "identity_verified"];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function sumCounts(perCategory: Record<string, CategoryMetric>, key: "tp" | "fp" | "fn"): number {
  return Object.values(perCategory).reduce((total, metric) => total + metric[key], 0);
}

function MetricBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9">{pct(value)}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-signal-amber" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-xl font-semibold text-zinc-100">{value}</span>
      {detail && <span className="text-xs text-zinc-500">{detail}</span>}
    </div>
  );
}

function MatchMark({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${
        ok ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
      }`}
      aria-label={ok ? "match" : "mismatch"}
    >
      {ok ? "✓" : "✕"}
    </span>
  );
}

function LabelSourceTag({ source }: { source: "objective" | "human" }) {
  return (
    <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
      {source === "objective" ? "objective" : "human"}
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
    return <p className="text-sm text-zinc-400">No eval runs in this report.</p>;
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
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
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

      <p className="text-sm text-zinc-400">
        {DETERMINISTIC_DIMENSIONS.map((key) => DIMENSION_LABELS[key]).join(", ")} are deterministic code checks;{" "}
        {judgedDimensions.map((key) => DIMENSION_LABELS[key]).join(", ")} are LLM-judged.
      </p>

      {metrics.selfConsistency && (
        <section className="flex flex-col gap-2 rounded-lg border border-zinc-800/80 bg-ink-raised px-4 py-4">
          <h2 className="text-lg font-medium text-zinc-100">Self-consistency</h2>
          <p className="text-sm text-zinc-400">
            How often the judge agrees with itself across {metrics.selfConsistency.k} runs of each call. Higher is more trustworthy.
          </p>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 pt-1 text-sm">
            <span className="text-2xl font-semibold tabular-nums text-signal-amber">{pct(metrics.selfConsistency.overall)}</span>
            {Object.entries(metrics.selfConsistency.perDimension).map(([key, v]) => (
              <span key={key} className="text-zinc-400">
                {DIMENSION_LABELS[key as DimensionKey] ?? key}:{" "}
                <span className="tabular-nums text-zinc-200">{pct(v.agreement)}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-100">Failure detection by category</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
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
                <tr key={category} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-2 pr-4">{FAILURE_LABELS[category as FailureCategory] ?? category}</td>
                  <td className="py-2 pr-4 tabular-nums"><MetricBar value={metric.precision} /></td>
                  <td className="py-2 pr-4 tabular-nums"><MetricBar value={metric.recall} /></td>
                  <td className="py-2 pr-4 tabular-nums">{pct(metric.f1)}</td>
                  <td className="py-2 pr-4 tabular-nums">{metric.support}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-500">
                    {metric.tp} / {metric.fp} / {metric.fn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-100">Gold vs predicted, per case</h2>
        <ul className="flex flex-col gap-2">
          {cases.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-zinc-400">{c.id}</span>
                <LabelSourceTag source={c.labelSource} />
              </div>
              <div className="flex flex-col gap-1 text-sm text-zinc-400 sm:flex-row sm:items-center sm:gap-4">
                <span className="flex items-center gap-1.5">
                  <MatchMark ok={c.failuresCorrect} />
                  gold: {failureList(c.gold.failures)} / predicted: {failureList(c.predicted.failures)}
                </span>
                <span className="flex items-center gap-1.5">
                  <MatchMark ok={c.bandCorrect} />
                  gold band: {c.gold.band} / predicted: {c.predicted.band} (score {Math.round(c.predicted.composite)})
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
