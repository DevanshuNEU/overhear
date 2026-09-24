import Link from "next/link";
import report from "../../../eval/report.json";
import type { EvalReport } from "@/eval/report";
import { EvalReportView } from "./EvalReportView";

export const dynamic = "force-static";

export default function EvalPage() {
  return (
    <div className="min-h-full bg-zinc-950">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
            &larr; Back to calls
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-100">How accurate is this QA?</h1>
          <p className="text-sm text-zinc-400">
            The judge graded against a gold-labeled set. Objective failures have deterministic ground truth,
            subjective quality is human-anchored.
          </p>
        </header>
        <EvalReportView report={report as EvalReport} />
      </main>
    </div>
  );
}
