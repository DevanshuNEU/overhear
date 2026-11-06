// The call, in order, with threads: a rail for each finding that needs attention runs through the
// items it rests on, and every item a finding cites carries a tag that links back to that finding.
import { useId } from "react";
import type { CallReport, Item } from "@/report/schema";
import { BACKEND_LOG_TAG, HEADING, ORDER_NOTE, SPEAKER_LABEL, tagResultSuffix } from "@/report/labels";
import { describeDid } from "./describe";
import { formatClock } from "./format";
import { RawDetail } from "./RawDetail";
import { RESULT_TONE } from "./StatusBadge";
import { railsAt, threadsOf, type Thread } from "./threads";

const RAIL_STEP = 14;
const DOT_TOP = 13;

const TAG_CLASS = {
  critical: "bg-report-critical-tint text-report-critical",
  warning: "bg-report-warning-tint text-report-warning",
  calm: "border border-report-line text-report-ink-2",
  muted: "border border-report-line text-report-ink-2",
};

function Rails({ railed, marks }: { railed: Thread[]; marks: ReturnType<typeof railsAt> }) {
  if (railed.length === 0) return null;
  return (
    <div aria-hidden className="relative shrink-0" style={{ width: railed.length * RAIL_STEP }}>
      {marks.map((m) => {
        const left = railed.findIndex((t) => t.id === m.id) * RAIL_STEP + 3;
        return (
          <span key={m.id} data-rail data-mark={m.mark}>
            <span
              className="absolute w-0.5 bg-report-accent"
              style={{ left: left + 3, top: m.first ? DOT_TOP + 5 : 0, bottom: m.last ? `calc(100% - ${DOT_TOP + 5}px)` : 0 }}
            />
            {m.mark === "dot" ? <span className="absolute size-2 rounded-full bg-report-accent" style={{ left: left + 1, top: DOT_TOP + 1 }} /> : null}
          </span>
        );
      })}
    </div>
  );
}

// Tags sit in the text column, under the words they belong to.
const TEXT_COLUMN = "sm:pl-[calc(3rem+4.5rem+1.5rem)]";

function Tags({ threads }: { threads: Thread[] }) {
  if (threads.length === 0) return null;
  return (
    <div className={`mt-1.5 flex flex-wrap gap-1.5 ${TEXT_COLUMN}`}>
      {threads.map((t) => (
        <a
          key={t.id}
          href={`#${t.anchor}`}
          className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-[12px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent ${TAG_CLASS[RESULT_TONE[t.result]]}`}
        >
          {t.label}
          <span className="sr-only">{tagResultSuffix(t.result)}</span>
        </a>
      ))}
    </div>
  );
}

function Body({ item, report }: { item: Item; report: CallReport }) {
  if (item.kind === "turn") {
    return (
      <div className="min-w-0 sm:grid sm:grid-cols-[3rem_4.5rem_1fr] sm:gap-x-3">
        <span className="mr-2 text-[13px] tabular-nums text-report-muted sm:mr-0 sm:pt-0.5 sm:text-right">{item.startSec === null ? "" : formatClock(item.startSec)}</span>
        <span className={`mr-2 text-[13px] font-medium sm:mr-0 sm:pt-0.5 ${item.role === "agent" ? "text-report-ink" : "text-report-muted"}`}>{SPEAKER_LABEL[item.role]}</span>
        <p className="[overflow-wrap:anywhere] text-[15px] leading-relaxed">{item.text}</p>
      </div>
    );
  }
  const did = describeDid(item, report.evidence)!;
  return (
    <div className={`min-w-0 ${TEXT_COLUMN}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="[overflow-wrap:anywhere] text-[14px] leading-relaxed text-report-ink-2">{did.line}</p>
        {did.backend ? <span className="rounded bg-report-accent-tint px-1.5 text-[12px] text-report-accent">{BACKEND_LOG_TAG}</span> : null}
      </div>
      <RawDetail raw={did.raw} />
    </div>
  );
}

export function CallTimeline({ report }: { report: CallReport }) {
  const id = useId();
  const threads = threadsOf(report);
  const railed = threads.filter((t) => t.railed);
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-4 text-base font-semibold">
        {HEADING.timeline}
      </h2>
      {report.evidence.ordering !== "sequence" ? <p className="mb-3 max-w-[62ch] text-sm text-report-ink-2">{ORDER_NOTE[report.evidence.ordering]}</p> : null}
      <ol className="border-t border-report-line">
        {report.evidence.items.map((item) => (
          <li key={item.seq} id={`item-${item.seq}`} className="flex scroll-mt-6 gap-2 target:bg-report-accent-tint target:outline target:outline-2 target:-outline-offset-2 target:outline-report-accent">
            <Rails railed={railed} marks={railsAt(threads, item.seq)} />
            <div className="min-w-0 flex-1 py-2">
              <Body item={item} report={report} />
              <Tags threads={threads.filter((t) => t.seqs.includes(item.seq))} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
