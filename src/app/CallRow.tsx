"use client";

// One call in the list: when it started, how long it ran, the verdict and the one line the report gives. A call
// with a report links to it. A call without one says why in place and does not link. A call still waiting for its
// turn shows skeleton bars where the verdict and the line will land, with the real time and length already there.
import { ChevronRight, Loader2 } from "lucide-react";
import type { PullRow } from "@/pull/pull";
import { formatDuration } from "@/report/labels";
import { Badge, ResultBadge, VerdictBadge } from "@/components/report/StatusBadge";
import { formatCallTime } from "./callListModel";
import { LIST_WORDS } from "./callListWords";

type Props = {
  row: PullRow;
  /** Zone for the call time. Unset means the browser's own. */
  timeZone?: string;
  /** The pull is over (done, stopped or failed), so a call that was never reached will not be. */
  settled: boolean;
  retrying: boolean;
  /** A retry of this call has come back and it is still an error. */
  retryFailed: boolean;
  onRetry: (callId: string) => void;
};

// On a phone: time, length and verdict on one line, the sentence under them. From sm up: one aligned line.
const GRID =
  "grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-3 sm:grid-cols-[9rem_6.5rem_9.5rem_minmax(0,1fr)_auto] sm:gap-y-0";

function Skeleton({ className }: { className: string }) {
  return <span aria-hidden className={`block h-4 rounded bg-report-calm-mark ${className}`} />;
}

function Verdict({ row, settled }: { row: PullRow; settled: boolean }) {
  if (row.state === "report" && row.verdict) return <VerdictBadge verdict={row.verdict} />;
  if (row.state === "no_content") return <ResultBadge result="not_run" />;
  if (row.state === "error") return <Badge tone="warning" label={LIST_WORDS.couldntLoad} />;
  if (settled) return <ResultBadge result="not_run" />;
  return (
    <>
      <Skeleton className="h-5 w-20 rounded-full" />
      <span className="sr-only">{LIST_WORDS.checking}</span>
    </>
  );
}

function Line({ row, settled, retryFailed }: { row: PullRow; settled: boolean; retryFailed: boolean }) {
  if (row.state === "report") {
    const quiet = row.verdict === "passed";
    return <span className={`text-sm leading-snug ${quiet ? "text-report-muted" : "font-medium text-report-ink"}`}>{row.headline}</span>;
  }
  if (row.state === "no_content") return <span className="text-sm leading-snug text-report-ink-2">{LIST_WORDS.noTranscript}</span>;
  if (row.state === "error") {
    return (
      <span className="text-sm leading-snug text-report-ink-2">
        {LIST_WORDS.couldntCheck}
        {retryFailed ? ` ${LIST_WORDS.stillCouldnt}` : ""}
      </span>
    );
  }
  return settled ? null : <Skeleton className="w-3/5 max-w-72" />;
}

export function CallRow({ row, timeZone, settled, retrying, retryFailed, onRetry }: Props) {
  const started = formatCallTime(row.startedAt, timeZone);
  const linked = row.state === "report";
  const cells = (
    <>
      <span className="text-sm font-medium tabular-nums">{started ?? "Time unknown"}</span>
      <span className="text-[13px] tabular-nums text-report-muted">{row.durationMs === null ? LIST_WORDS.unknownLength : formatDuration(row.durationMs)}</span>
      <span className="justify-self-end sm:justify-self-start">
        <Verdict row={row} settled={settled} />
      </span>
      <span className="col-span-3 sm:col-span-1">
        <Line row={row} settled={settled} retryFailed={retryFailed} />
      </span>
      {linked ? (
        <ChevronRight aria-hidden className="hidden size-4 text-report-muted sm:block" />
      ) : row.state === "error" ? (
        <button
          type="button"
          onClick={() => onRetry(row.callId)}
          disabled={retrying}
          className="col-span-3 inline-flex min-h-11 items-center justify-center gap-2 justify-self-start rounded-md border border-report-line-strong bg-report-surface px-4 text-sm font-semibold enabled:hover:bg-report-calm-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:text-report-ink-2 sm:col-span-1"
        >
          {retrying ? (
            <>
              <span aria-hidden className="report-delayed inline-flex">
                <Loader2 className="size-4 motion-safe:animate-spin" />
              </span>
              {LIST_WORDS.retrying}
            </>
          ) : (
            LIST_WORDS.retry
          )}
        </button>
      ) : null}
    </>
  );

  return (
    <li data-call-id={row.callId} data-state={row.state === "report" ? row.verdict : row.state} className="border-b border-report-line last:border-b-0">
      {linked ? (
        <a
          href={`/reports/${encodeURIComponent(row.callId)}`}
          className={`${GRID} -outline-offset-2 hover:bg-report-calm-mark/40 focus-visible:outline-2 focus-visible:outline-report-accent`}
        >
          {cells}
        </a>
      ) : (
        <div className={GRID}>{cells}</div>
      )}
    </li>
  );
}
