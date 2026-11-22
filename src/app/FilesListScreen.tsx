"use client";

// The call list for session report files the person opened (`/files`): the same pieces as the Retell list (headline in
// two tones, filters kept in the address, the two groups, rows, the empty filter state) fed from what the server holds
// in memory instead of a pull. There is no pull to repeat, so no "Check the last" and no "Check again". The person
// can open more reports, which adds to the set, or clear it, which goes back to `/`. Files that were set aside are
// listed under the calls, by name and a fixed reason.
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { PROBLEM_REASON, type FileProblem } from "@/files/labels";
import type { PullRow } from "@/pull/pull";
import { VERDICT_LABEL } from "@/report/labels";
import type { Verdict } from "@/report/schema";
import { BUTTON } from "./callClient";
import { CallRow } from "./CallRow";
import { FilterLink, hrefFor } from "./CallListScreen";
import { countRows, filterRows, parseFilter, splitRows, type Filter } from "./callListModel";
import { LIST_WORDS } from "./callListWords";
import { clearReportFiles, openReportFiles } from "./filesClient";
import { FILES_WORDS } from "./filesWords";
import { ProductNav, type NavView } from "./ProductNav";

const BASE = "/files";
const noop = () => {};

type Props = {
  /** The calls the server holds, newest first. */
  rows: PullRow[];
  /** The files it set aside. */
  problems: FileProblem[];
  /** Where the shell's links go: files only (no key), or the key and the files. */
  view: Extract<NavView, "files" | "both">;
  /** Zone for call times. Unset means the browser's own. */
  timeZone?: string;
};

export function FilesListScreen({ rows: first, problems: firstProblems, view, timeZone }: Props) {
  const router = useRouter();
  const filter = parseFilter(useSearchParams()?.get("show"));
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState(first);
  const [problems, setProblems] = useState(firstProblems);
  const [busy, setBusy] = useState<"opening" | "clearing" | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const counts = countRows(rows);
  const { attention, rest } = splitRows(rows);
  const matches = filter === "all" ? rows : filterRows(rows, filter);
  const select = (next: Filter) => router.replace(hrefFor(next, BASE), { scroll: false });
  const from: Verdict | undefined = filter === "all" ? undefined : filter;
  const mixed = new Set(rows.map((r) => r.platform)).size > 1;

  async function open(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (files.length === 0 || busy) return;
    setBusy("opening");
    setTrouble(null);
    const result = await openReportFiles(files);
    if (result.ok) {
      setRows(result.rows);
      setProblems(result.problems);
    } else {
      setTrouble(result.message);
    }
    setBusy(null);
  }

  async function clear() {
    if (busy) return;
    setBusy("clearing");
    setTrouble(null);
    if (await clearReportFiles()) {
      router.push("/");
      return;
    }
    setTrouble(FILES_WORDS.clearFailed);
    setBusy(null);
  }

  const renderRows = (list: PullRow[]) =>
    list.map((row) => <CallRow key={row.callId} row={row} timeZone={timeZone} settled retrying={false} retryFailed={false} onRetry={noop} from={from} source="files" showPlatform={mixed} />);

  const spinner = (
    <span aria-hidden className="report-delayed inline-flex">
      <Loader2 className="size-4 motion-safe:animate-spin" />
    </span>
  );

  return (
    <div className="report min-h-screen bg-report-canvas font-sans text-report-ink">
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6">
        <ProductNav current={view === "both" ? "files" : "calls"} view={view} />
        <main>
          <h1 className="max-w-[760px] font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[32px] sm:tracking-[-0.02em]">
            {rows.length > 0 ? (
              <>
                {FILES_WORDS.headline(counts.failed, counts.total)} <span className="text-report-muted">{FILES_WORDS.headlineNext(rows.length)}</span>
              </>
            ) : (
              <>
                {FILES_WORDS.noCallsHeadline} <span className="text-report-muted">{FILES_WORDS.noCallsNext}</span>
              </>
            )}
          </h1>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            {counts.total > 0 ? (
              <nav aria-label={LIST_WORDS.summaryLabel} className="flex flex-wrap gap-x-6 text-sm">
                <FilterLink base={BASE} label={LIST_WORDS.all} n={counts.total} filter="all" active={filter === "all"} onSelect={select} />
                <FilterLink base={BASE} label={VERDICT_LABEL.failed} n={counts.failed} tone="critical" filter="failed" active={filter === "failed"} onSelect={select} />
                <FilterLink base={BASE} label={VERDICT_LABEL.needs_review} n={counts.needsReview} tone="warning" filter="needs_review" active={filter === "needs_review"} onSelect={select} />
                <FilterLink base={BASE} label={VERDICT_LABEL.passed} n={counts.passed} filter="passed" active={filter === "passed"} onSelect={select} />
                <FilterLink base={BASE} label={VERDICT_LABEL.nothing_done} n={counts.nothingDone} filter="nothing_done" active={filter === "nothing_done"} onSelect={select} />
              </nav>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={input}
                type="file"
                accept=".json,application/json"
                multiple
                hidden
                tabIndex={-1}
                aria-label={FILES_WORDS.openMore}
                onChange={(e) => {
                  void open(e.currentTarget.files);
                  e.currentTarget.value = "";
                }}
              />
              <button type="button" disabled={busy !== null} onClick={() => input.current?.click()} className={BUTTON}>
                {busy === "opening" ? (
                  <>
                    {spinner}
                    {FILES_WORDS.opening}
                  </>
                ) : (
                  FILES_WORDS.openMore
                )}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void clear()} className={BUTTON}>
                {busy === "clearing" ? (
                  <>
                    {spinner}
                    {FILES_WORDS.clearing}
                  </>
                ) : (
                  FILES_WORDS.clear
                )}
              </button>
            </div>
          </div>

          <div role="status" className="mt-3 text-sm empty:mt-0">
            {trouble ? (
              <p className="flex gap-2 text-report-warning">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="font-semibold">{trouble}</span>
              </p>
            ) : null}
          </div>

          {rows.length > 0 && filter === "all" ? (
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
                  <ul aria-label={attention.length > 0 ? LIST_WORDS.restHeading : FILES_WORDS.listLabel} className="border-y border-report-line bg-report-surface">
                    {renderRows(rest)}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {filter !== "all" && matches.length > 0 ? (
            <div className="-mx-3 mt-6">
              <ul aria-label={VERDICT_LABEL[filter]} className="border-y border-report-line bg-report-surface">
                {renderRows(matches)}
              </ul>
            </div>
          ) : null}

          {filter !== "all" && matches.length === 0 && counts.total > 0 ? (
            <div className="mt-10 max-w-[760px]">
              <h2 className="text-lg font-semibold">{FILES_WORDS.noMatches[filter](counts.total)}</h2>
              <Link
                href={BASE}
                onClick={(e) => {
                  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  select("all");
                }}
                className="mt-2 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
              >
                {LIST_WORDS.showAll}
              </Link>
            </div>
          ) : null}

          {matches.some((r) => r.notes?.includes("request_not_checked")) ? <p className="mt-4 text-[13px] text-report-muted">{LIST_WORDS.requestNotChecked}</p> : null}

          {problems.length > 0 ? (
            <section aria-labelledby="set-aside" className="mt-10 max-w-[760px]">
              <h2 id="set-aside" className="text-sm font-semibold">
                {FILES_WORDS.problemsHeading}
              </h2>
              <ul className="mt-1 space-y-1 text-sm text-report-ink-2">
                {problems.map((p) => (
                  <li key={p.file} className="break-all">
                    {FILES_WORDS.problem(p.file, PROBLEM_REASON[p.reason])}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
