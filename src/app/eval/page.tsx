import report from "../../../eval/report.json";
import type { EvalReport } from "@/eval/report";
import { EvalReportView } from "./EvalReportView";
import { SiteNav } from "../components/SiteNav";

export const dynamic = "force-static";

export default function EvalPage() {
  return (
    <div className="min-h-full bg-ink">
      <SiteNav />
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-signal-amber">The honest number</span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">How accurate is this QA?</h1>
          <p className="text-sm text-muted-foreground">
            The judge graded against a gold-labeled set. Objective failures have deterministic ground truth,
            subjective quality is human-anchored.
          </p>
        </header>
        <EvalReportView report={report as EvalReport} />
      </main>
    </div>
  );
}
