// The answer: the verdict, the one sentence, and the facts that say how far to trust it.
import type { CallReport } from "@/report/schema";
import { FACT_LABEL, KEY_FACTS_LABEL, PLATFORM_LABEL, TIER_LABEL, formatDuration, rulesSummary } from "@/report/labels";
import { CopyId } from "./CopyId";
import { VerdictBadge } from "./StatusBadge";
import { formatStarted } from "./format";

function facts(report: CallReport): { label: string; value: string }[] {
  const { evidence } = report;
  const list = [
    { label: FACT_LABEL.platform, value: PLATFORM_LABEL[report.platform] },
    evidence.callFields.duration_ms !== undefined ? { label: FACT_LABEL.length, value: formatDuration(evidence.callFields.duration_ms) } : null,
    evidence.callStartMs !== null ? { label: FACT_LABEL.started, value: formatStarted(evidence.callStartMs, report.timezone) } : null,
    { label: FACT_LABEL.evidence, value: TIER_LABEL[evidence.tier] },
    { label: FACT_LABEL.rules, value: rulesSummary(report.results) },
  ];
  return list.filter((f): f is { label: string; value: string } => f !== null);
}

export function ReportHeader({ report }: { report: CallReport }) {
  return (
    <header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <VerdictBadge verdict={report.verdict} />
        <span className="font-mono text-[13px] tabular-nums text-report-ink-2">{report.callId}</span>
        <CopyId value={report.callId} />
      </div>
      <h1 className="mt-4 max-w-[34ch] text-2xl font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[28px]">{report.headline}</h1>
      <ul aria-label={KEY_FACTS_LABEL} className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
        {facts(report).map((f) => (
          <li key={f.label}>
            <div className="text-[13px] text-report-muted">{f.label}</div>
            <div className="text-sm tabular-nums">{f.value}</div>
          </li>
        ))}
      </ul>
    </header>
  );
}
