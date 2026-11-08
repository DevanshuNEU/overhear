// The answer: the verdict, the one sentence, and the facts that say how far to trust it.
import type { CallReport } from "@/report/schema";
import { FACT_LABEL, KEY_FACTS_LABEL, PLATFORM_LABEL, evidenceFact, formatDuration, rulesSummary } from "@/report/labels";
import { answerOf } from "./answer";
import { CopyId } from "./CopyId";
import { ExperienceSection } from "./ExperienceSection";
import { KeepAction, KeepPanel, KeepProvider } from "./KeepAsTest";
import { VerdictBadge } from "./StatusBadge";
import { formatStarted } from "./format";

function facts(report: CallReport): { label: string; value: string }[] {
  const { evidence } = report;
  const started = evidence.callStartMs === null ? null : formatStarted(evidence.callStartMs, report.timezone);
  const list = [
    { label: FACT_LABEL.platform, value: PLATFORM_LABEL[report.platform] },
    Number.isFinite(evidence.callFields.duration_ms) && (evidence.callFields.duration_ms ?? -1) >= 0 ? { label: FACT_LABEL.length, value: formatDuration(evidence.callFields.duration_ms ?? 0) } : null,
    started ? { label: FACT_LABEL.started, value: started } : null,
    { label: FACT_LABEL.evidence, value: evidenceFact(evidence.tier, evidence.gaps.length) },
    { label: FACT_LABEL.rules, value: rulesSummary(report.results) },
  ];
  return list.filter((f): f is { label: string; value: string } => f !== null);
}

/** A Nothing done headline says the verdict first and the reason after it, so the reason is set back in muted type. */
function QuietHeadline({ text }: { text: string }) {
  const cut = text.indexOf(". ");
  if (cut === -1) return <span data-headline>{text}</span>;
  return (
    <span data-headline>
      {text.slice(0, cut + 1)} <span data-headline-rest className="text-report-muted">{text.slice(cut + 2)}</span>
    </span>
  );
}

/**
 * `keep` (local mode only) adds "Keep as a test": one quiet action at the end of the verdict row, and, when it is clicked, a
 * panel under the facts. Closed, it adds nothing between the verdict and the sentence that answers the page.
 */
export function ReportHeader({ report, keep = false }: { report: CallReport; keep?: boolean }) {
  const answer = answerOf(report);
  const header = (
    <header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <VerdictBadge verdict={report.verdict} />
        <span className="font-mono text-[13px] tabular-nums text-report-ink-2">{report.callId}</span>
        <CopyId value={report.callId} />
        {keep ? (
          <div className="sm:ml-auto">
            <KeepAction />
          </div>
        ) : null}
      </div>
      <h1 className="mt-4 max-w-[46ch] break-words text-2xl font-semibold leading-[1.25] tracking-[-0.01em] sm:text-[26px]">
        {answer ? <span data-answer>{answer.text}</span> : report.verdict === "nothing_done" ? <QuietHeadline text={report.headline} /> : <span data-headline>{report.headline}</span>}
      </h1>
      <ExperienceSection report={report} />
      <ul aria-label={KEY_FACTS_LABEL} className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
        {facts(report).map((f) => (
          <li key={f.label}>
            <div className="text-[13px] text-report-muted">{f.label}</div>
            <div className="text-sm tabular-nums">{f.value}</div>
          </li>
        ))}
      </ul>
      {keep ? <KeepPanel /> : null}
    </header>
  );
  return keep ? <KeepProvider report={report}>{header}</KeepProvider> : header;
}
