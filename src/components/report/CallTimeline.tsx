"use client";

// The call, in order, with threads: a rail for each finding that needs attention runs through the
// items it rests on, and every item a finding cites carries a tag that links back to that finding.
import { useId, useState } from "react";
import type { CallReport, Detection } from "@/report/schema";
import { BACKEND_LOG_TAG, HEADING, NUMBERS_SWITCH, ORDER_NOTE, SPEAKER_LABEL, tagResultSuffix } from "@/report/labels";
import { formatClock } from "./format";
import { RawDetail } from "./RawDetail";
import { RESULT_TONE } from "./StatusBadge";
import { timelineRows, type TimelineRow } from "./rows";
import { citedClaims } from "./claims";
import { markQuotes } from "./highlight";
import { readableSpans } from "./readable";
import { railColumns, railMarks, threadsOf, type Thread } from "./threads";

const RAIL_STEP = 14;

/** The highlight on claim words, by the result of the finding they belong to. Only findings that need attention are marked here. */
const MARK_CLASS = { violated: "bg-report-critical-mark", unverified: "bg-report-warning-mark" } as const;
const DOT_TOP = 13;

const TAG_CLASS = {
  critical: "bg-report-critical-tint text-report-critical",
  warning: "bg-report-warning-tint text-report-warning",
  calm: "border border-report-line text-report-ink-2",
  muted: "border border-report-line text-report-ink-2",
};

function Rails({ columns, marks }: { columns: Map<string, number>; marks: ReturnType<typeof railMarks>[number] }) {
  const width = new Set(columns.values()).size;
  if (width === 0) return null;
  return (
    <div aria-hidden className="relative shrink-0" style={{ width: width * RAIL_STEP }}>
      {marks.map((m) => {
        const col = columns.get(m.id) ?? 0;
        const left = col * RAIL_STEP + 3;
        return (
          <span key={m.id} data-rail data-mark={m.mark} data-col={col}>
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

// What the system did is set apart from speech by a hairline on the left, in the text column.
const TEXT_COLUMN = "sm:ml-[calc(3rem+4.5rem+0.75rem)]";

/** Only a finding that needs attention is tagged on the timeline, the same rule as the rails. */
const needsAttention = (t: Thread) => t.result === "violated" || t.result === "unverified";

function TagLinks({ threads }: { threads: Thread[] }) {
  return threads.map((t) => (
    <a
      key={t.id}
      href={`#${t.anchor}`}
      className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-[12px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent ${TAG_CLASS[RESULT_TONE[t.result]]}`}
    >
      {t.label}
      <span className="sr-only">{tagResultSuffix(t.result)}</span>
    </a>
  ));
}

type Turn = Extract<TimelineRow, { kind: "speech" }>["turns"][number];

/** The claim words of any broken or unchecked finding that cites this turn, each with its own finding's result. Broken first, so words two findings share take the broken mark. */
function claimQuotes(turn: Turn, tags: Thread[], detections: Detection[]) {
  return [...tags]
    .sort((a, b) => Number(b.result === "violated") - Number(a.result === "violated"))
    .flatMap((t) =>
      t.contract
        ? citedClaims({ text: t.text ?? "" }, t.contract, detections)
            .filter((d) => d.seq === turn.seq)
            .map((d) => ({ quote: d.quote, markClass: MARK_CLASS[t.result === "violated" ? "violated" : "unverified"] }))
        : [],
    );
}

/** Turns by one speaker: when and who once, then each turn's words held to a readable line length. */
function Speech({ row, threads, detections, digits }: { row: Extract<TimelineRow, { kind: "speech" }>; threads: Thread[]; detections: Detection[]; digits: boolean }) {
  const first = row.turns[0];
  return (
    <div className="min-w-0 py-2.5 sm:grid sm:grid-cols-[3rem_4.5rem_1fr] sm:gap-x-3">
      <span className="mr-2 text-[13px] tabular-nums text-report-muted sm:mr-0 sm:pt-0.5 sm:text-right">{first.startSec === null ? "" : formatClock(first.startSec)}</span>
      <span className={`mr-2 text-[13px] font-medium sm:mr-0 sm:pt-0.5 ${row.role === "agent" ? "text-report-ink" : "text-report-muted"}`}>{SPEAKER_LABEL[row.role]}</span>
      <div className="min-w-0 space-y-1">
        {row.turns.map((turn, i) => {
          const tags = threads.filter((t) => t.seqs.includes(turn.seq));
          const quotes = claimQuotes(turn, tags, detections);
          return (
            <div key={turn.seq}>
              <p id={i === 0 ? undefined : `item-${turn.seq}`} className="max-w-[68ch] scroll-mt-6 [overflow-wrap:anywhere] text-[15px] leading-relaxed target:bg-report-accent-tint">
                {markQuotes(turn.text, quotes, MARK_CLASS.unverified, { readable: digits })}
              </p>
              {tags.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <TagLinks threads={tags} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What the system did: one line per action, with its raw detail and the findings that need attention on that line. */
function Action({ row, threads }: { row: Extract<TimelineRow, { kind: "action" }>; threads: Thread[] }) {
  const { entry } = row;
  return (
    <div data-system className={`min-w-0 border-l-2 border-report-line py-1.5 pl-3 ${TEXT_COLUMN}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="[overflow-wrap:anywhere] text-[14px] leading-relaxed text-report-ink-2">{entry.line}</p>
        {entry.backend ? <span className="rounded bg-report-accent-tint px-1.5 text-[12px] text-report-accent">{BACKEND_LOG_TAG}</span> : null}
        <RawDetail raw={entry.raw} inline />
        <TagLinks threads={threads} />
      </div>
      {row.seqs.slice(1).map((seq) => (
        <span key={seq} id={`item-${seq}`} aria-hidden className="sr-only" />
      ))}
    </div>
  );
}

export function CallTimeline({ report }: { report: CallReport }) {
  const id = useId();
  const threads = threadsOf(report);
  const columns = railColumns(threads);
  const rows = timelineRows(report.evidence);
  const marks = railMarks(threads, rows.map((r) => r.seqs));
  const tagged = threads.filter(needsAttention);
  // Spoken numbers show as digits until the person asks for the exact words. The switch is there only when some number was changed.
  const [digits, setDigits] = useState(true);
  const anyDigits = rows.some(
    (row) =>
      row.kind === "speech" &&
      row.turns.some((turn) => {
        const marks = claimQuotes(turn, tagged.filter((t) => t.seqs.includes(turn.seq)), report.detections)
          .map((q) => ({ start: turn.text.indexOf(q.quote), end: turn.text.indexOf(q.quote) + q.quote.length }))
          .filter((m) => m.start >= 0);
        return readableSpans(turn.text, marks).length > 0;
      }),
  );
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 id={id} className="text-base font-semibold">
          {HEADING.timeline}
        </h2>
        {anyDigits ? (
          <button
            type="button"
            onClick={() => setDigits((d) => !d)}
            className="-mr-2 inline-flex min-h-11 items-center rounded-md px-2 text-[13px] text-report-muted hover:text-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent sm:min-h-8"
          >
            {digits ? NUMBERS_SWITCH.toExact : NUMBERS_SWITCH.toDigits}
          </button>
        ) : null}
      </div>
      {report.evidence.ordering !== "sequence" ? <p className="mb-3 max-w-[62ch] text-sm text-report-ink-2">{ORDER_NOTE[report.evidence.ordering]}</p> : null}
      <ol className="border-t border-report-line">
        {rows.map((row, i) => (
          <li
            key={row.seqs[0]}
            id={`item-${row.seqs[0]}`}
            className="flex scroll-mt-6 gap-2 target:bg-report-accent-tint target:outline target:outline-2 target:-outline-offset-2 target:outline-report-accent has-[:target]:bg-report-accent-tint"
          >
            <Rails columns={columns} marks={marks[i]} />
            <div className="min-w-0 flex-1">
              {row.kind === "speech" ? (
                <Speech row={row} threads={tagged} detections={report.detections} digits={digits} />
              ) : (
                <Action row={row} threads={tagged.filter((t) => t.seqs.some((s) => row.seqs.includes(s)))} />
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
