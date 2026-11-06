// What we could not check, said once: each gap in plain words, the engine's own detail, the rules it stopped
// and where it is in the call. The rules below point here in one line and do not repeat it.
import { TriangleAlert } from "lucide-react";
import type { CallReport, Gap } from "@/report/schema";
import { CONTRACT_TITLE, GAP_LABEL, HEADING, SHOW_IN_CALL, blockedLine, capitalize } from "@/report/labels";
import { gapAnchor } from "./threads";

/**
 * The rules this gap stopped: those whose findings name its kind of gap, and those whose findings cite an item
 * the gap touches (a gap on an item makes a finding that rests on it unverified, named or not).
 */
function stoppedBy(report: CallReport, gap: Gap): string[] {
  const touches = (seqs: number[]) => seqs.some((s) => gap.seqs.includes(s));
  return report.results
    .filter((c) => c.result === "unverified" && c.findings.some((f) => f.gaps.includes(gap.code) || touches([...f.said, ...f.did])))
    .map((c) => capitalize(CONTRACT_TITLE[c.contract]));
}

export function GapsSection({ report }: { report: CallReport }) {
  const gaps = report.evidence.gaps;
  if (gaps.length === 0) return null;
  return (
    <section id="gaps" aria-labelledby="gaps-heading" className="scroll-mt-6">
      <h2 id="gaps-heading" className="mb-3 text-base font-semibold">
        {HEADING.gaps}
      </h2>
      <ul className="divide-y divide-report-line border-y border-report-line">
        {gaps.map((g, i) => {
          const first = Math.min(...g.seqs);
          const stopped = stoppedBy(report, g);
          return (
            <li key={i} id={gapAnchor(i)} className="scroll-mt-6 py-4 target:bg-report-accent-tint">
              <p className="flex items-start gap-2 text-base font-medium text-report-warning">
                <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={2.5} />
                {GAP_LABEL[g.code]}
              </p>
              <p className="mt-1 max-w-[62ch] break-words text-[15px] text-report-ink-2">{g.detail}</p>
              {stopped.length > 0 ? <p className="mt-1 max-w-[62ch] text-[15px]">{blockedLine(stopped)}</p> : null}
              {Number.isFinite(first) ? (
                <a
                  href={`#item-${first}`}
                  className="mt-1 inline-block rounded py-1 text-[13px] text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
                >
                  {SHOW_IN_CALL}
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
