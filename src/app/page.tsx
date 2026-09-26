// Overhear home: a product landing over the live QA dashboard. Queries the
// database at request time (see the `dynamic` export below), so it cannot be
// statically prerendered.
import { db } from "@/db/client";
import { ensureDemoData } from "@/demo/ensure";
import { failureBreakdown, listCalls } from "@/qa/queries";
import type { CategoryMetric, EvalReport } from "@/eval/report";
import evalReport from "../../eval/report.json";
import { AutoRefresh } from "./components/AutoRefresh";
import { CallList } from "./components/CallList";
import { FailureBreakdown } from "./components/FailureBreakdown";
import { Hero } from "./components/Hero";
import { Reveal } from "./components/Reveal";
import { SiteNav } from "./components/SiteNav";
import { TrustCards } from "./components/TrustCards";
import { TryItCard } from "./components/TryItCard";
import { WebCallWidget } from "./components/WebCallWidget";

export const dynamic = "force-dynamic";

function headlineCounts(report: EvalReport): { caught: number; planted: number; sample: boolean } {
  const run = report.runs[0];
  if (!run) return { caught: 0, planted: 0, sample: Boolean(report.placeholder) };
  const perCategory = Object.values(run.metrics.failureDetection.perCategory) as CategoryMetric[];
  const caught = perCategory.reduce((total, metric) => total + metric.tp, 0);
  const planted = perCategory.reduce((total, metric) => total + metric.tp + metric.fn, 0);
  return { caught, planted, sample: Boolean(report.placeholder) };
}

export default async function Home() {
  // Keep the shared demo self-serving: make sure the test personas and enough
  // near-term open slots exist before showing the page. Throttled internally, so
  // the 5-second auto-refresh does not turn this into a write on every poll. A
  // failure here must never take down the dashboard, so it is logged, not thrown.
  await ensureDemoData(db).catch((err) => console.error("ensureDemoData failed", err));

  const [calls, failures] = await Promise.all([listCalls(db), failureBreakdown(db)]);
  const { caught, planted, sample } = headlineCounts(evalReport as EvalReport);

  return (
    <div className="min-h-full bg-background">
      <AutoRefresh />
      <SiteNav />
      <main className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-10">
        <Hero caught={caught} planted={planted} sample={sample} />

        <section className="grid gap-4 sm:grid-cols-2">
          <WebCallWidget />
          <TryItCard />
        </section>

        <TrustCards />

        <Reveal>
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">Signal log</h2>
              <FailureBreakdown items={failures} />
            </div>
            <CallList calls={calls} />
          </section>
        </Reveal>
      </main>
    </div>
  );
}
