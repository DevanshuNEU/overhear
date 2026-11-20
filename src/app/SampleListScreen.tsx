"use client";

// What `/` shows on a hosted copy: the sample calls, each already checked by the engine on the server. It reuses the
// call list's rows, filters and counts, and has none of its pull: no polling, no choice of how many calls, no
// Check again, no Disconnect. Which calls show is in the address (?show=failed), as on the local list.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { PullRow } from "@/pull/pull";
import { VERDICT_LABEL } from "@/report/labels";
import type { Verdict } from "@/report/schema";
import { CallRow } from "./CallRow";
import { FilterLink, hrefFor } from "./CallListScreen";
import { countRows, filterRows, parseFilter, splitRows, type Filter } from "./callListModel";
import { LIST_WORDS } from "./callListWords";
import { DemoCallBand } from "./DemoCallBand";
import { ProductNav } from "./ProductNav";
import { SAMPLE_WORDS } from "./sampleListWords";

type Props = {
  /** The sample calls, as the server checked them. */
  rows: PullRow[];
};

const noop = () => {};

export function SampleListScreen({ rows }: Props) {
  const router = useRouter();
  const filter = parseFilter(useSearchParams()?.get("show"));
  const counts = countRows(rows);
  const { attention, rest } = splitRows(rows);
  const matches = filter === "all" ? rows : filterRows(rows, filter);
  const select = (next: Filter) => router.replace(hrefFor(next), { scroll: false });
  const from: Verdict | undefined = filter === "all" ? undefined : filter;

  const renderRows = (list: PullRow[]) =>
    list.map((row) => <CallRow key={row.callId} row={row} timeZone="UTC" settled retrying={false} retryFailed={false} onRetry={noop} from={from} showTime={false} />);

  return (
    <div className="report min-h-screen bg-report-canvas font-sans text-report-ink">
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6">
        <ProductNav current="calls" hosted />
        <main>
          <h1 className="max-w-[760px] font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[32px] sm:tracking-[-0.02em]">
            {SAMPLE_WORDS.failedHeadline(counts.failed, counts.total)} <span className="text-report-muted">{SAMPLE_WORDS.headlineNext}</span>
          </h1>

          <DemoCallBand />

          <nav aria-label={LIST_WORDS.summaryLabel} className="mt-8 flex flex-wrap gap-x-6 text-sm">
            <FilterLink label={LIST_WORDS.all} n={counts.total} filter="all" active={filter === "all"} onSelect={select} />
            <FilterLink label={VERDICT_LABEL.failed} n={counts.failed} tone="critical" filter="failed" active={filter === "failed"} onSelect={select} />
            <FilterLink label={VERDICT_LABEL.needs_review} n={counts.needsReview} tone="warning" filter="needs_review" active={filter === "needs_review"} onSelect={select} />
            <FilterLink label={VERDICT_LABEL.passed} n={counts.passed} filter="passed" active={filter === "passed"} onSelect={select} />
            <FilterLink label={VERDICT_LABEL.nothing_done} n={counts.nothingDone} filter="nothing_done" active={filter === "nothing_done"} onSelect={select} />
          </nav>

          {filter === "all" ? (
            <div className="-mx-3 mt-6">
              {attention.length > 0 ? (
                <>
                  <h2 className="mb-1 px-3 text-sm font-semibold">{LIST_WORDS.attentionHeading}</h2>
                  <ul aria-label={LIST_WORDS.attentionHeading} className="border-y border-report-line bg-report-surface">
                    {renderRows(attention)}
                  </ul>
                </>
              ) : null}
              {rest.length > 0 ? (
                <>
                  {attention.length > 0 ? <h2 className="mb-1 mt-8 px-3 text-sm font-semibold">{LIST_WORDS.restHeading}</h2> : null}
                  <ul aria-label={attention.length > 0 ? LIST_WORDS.restHeading : SAMPLE_WORDS.listLabel} className="border-y border-report-line bg-report-surface">
                    {renderRows(rest)}
                  </ul>
                </>
              ) : null}
            </div>
          ) : matches.length > 0 ? (
            <div className="-mx-3 mt-6">
              <ul aria-label={VERDICT_LABEL[filter]} className="border-y border-report-line bg-report-surface">
                {renderRows(matches)}
              </ul>
            </div>
          ) : (
            <div className="mt-10 max-w-[760px]">
              <h2 className="text-lg font-semibold">{SAMPLE_WORDS.noMatches[filter]}</h2>
              <Link
                href="/"
                onClick={(e) => {
                  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  select("all");
                }}
                className="mt-2 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
              >
                {SAMPLE_WORDS.showAll}
              </Link>
            </div>
          )}

          {matches.some((r) => r.notes?.includes("request_not_checked")) ? <p className="mt-4 text-[13px] text-report-muted">{LIST_WORDS.requestNotChecked}</p> : null}

          <p className="mt-4 max-w-[760px] text-[13px] text-report-muted">{SAMPLE_WORDS.footer}</p>
        </main>
      </div>
    </div>
  );
}
