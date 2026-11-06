// The third part of a failure, after what happened and how we know: what to do next. It shows only when there
// is something to do, so a call that held has no empty column. Steps are checks the evidence supports.
import type { CallReport } from "@/report/schema";
import { NEXT_HEADING, COPY_ID_FOR_LOGS } from "@/report/labels";
import { CopyId } from "./CopyId";
import { nextStepsOf } from "./stepsOf";

export function NextSteps({ report, className = "" }: { report: CallReport; className?: string }) {
  const steps = nextStepsOf(report);
  if (steps.length === 0) return null;
  return (
    <aside aria-labelledby="next-heading" className={className}>
      <h2 id="next-heading" className="mb-4 text-base font-semibold">
        {NEXT_HEADING}
      </h2>
      <ol className="space-y-5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-report-line-strong text-[12px] tabular-nums text-report-ink-2">
              {i + 1}
            </span>
            <p className="min-w-0 text-[15px] leading-relaxed text-report-ink-2">
              <strong className="font-semibold text-report-ink">{step.lead}</strong> {step.text}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-6">
        <CopyId value={report.callId} label={COPY_ID_FOR_LOGS} />
      </div>
    </aside>
  );
}
