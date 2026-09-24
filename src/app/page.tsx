// Overhear dashboard home page. Queries the database at request time
// (never at build time; see the `dynamic` export below), so it cannot be
// statically prerendered.
import Link from "next/link";
import { db } from "@/db/client";
import { ensureDemoData } from "@/demo/ensure";
import { failureBreakdown, listCalls } from "@/qa/queries";
import type { CategoryMetric, EvalReport } from "@/eval/report";
import evalReport from "../../eval/report.json";
import { AutoRefresh } from "./components/AutoRefresh";
import { CallList } from "./components/CallList";
import { FailureBreakdown } from "./components/FailureBreakdown";
import { TryItCard } from "./components/TryItCard";
import { WebCallWidget } from "./components/WebCallWidget";

export const dynamic = "force-dynamic";

function evalHeadline(report: EvalReport): { text: string; sample: boolean } | null {
  const run = report.runs[0];
  if (!run) return null;

  const perCategory = Object.values(run.metrics.failureDetection.perCategory) as CategoryMetric[];
  const tp = perCategory.reduce((total, metric) => total + metric.tp, 0);
  const fn = perCategory.reduce((total, metric) => total + metric.fn, 0);
  const caught = tp;
  const planted = tp + fn;
  const { inBand, total } = run.metrics.scoreCalibration;

  const text = `This QA caught ${caught} of ${planted} planted failures, in the right band on ${inBand} of ${total} calls.`;
  return { text, sample: Boolean(report.placeholder) };
}

export default async function Home() {
  // Keep the shared demo self-serving: make sure the test personas and enough
  // near-term open slots exist before showing the page. Throttled internally, so
  // the 5-second auto-refresh does not turn this into a write on every poll. A
  // failure here must never take down the dashboard, so it is logged, not thrown.
  await ensureDemoData(db).catch((err) => console.error("ensureDemoData failed", err));

  const [calls, failures] = await Promise.all([listCalls(db), failureBreakdown(db)]);
  const headline = evalHeadline(evalReport as EvalReport);

  return (
    <div className="min-h-full bg-zinc-950">
      <AutoRefresh />
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-zinc-100">Overhear</h1>
          <p className="text-sm text-zinc-400">
            QA scores for every call the voice agent has handled, newest first.
          </p>
        </header>

        <WebCallWidget />

        <TryItCard />

        {headline && (
          <Link
            href="/eval"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300 transition-colors hover:border-zinc-700"
          >
            {headline.text} {headline.sample && <span className="text-zinc-500">(sample data)</span>} See how this
            QA was measured &rarr;
          </Link>
        )}

        <FailureBreakdown items={failures} />

        <CallList calls={calls} />
      </main>
    </div>
  );
}
