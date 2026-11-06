// What is missing from the evidence, said once, with the engine's own detail and a link to where it is.
import { TriangleAlert } from "lucide-react";
import type { CallReport } from "@/report/schema";
import { GAP_LABEL, HEADING, SHOW_IN_CALL } from "@/report/labels";
import { gapAnchor } from "./threads";

export function GapsSection({ report }: { report: CallReport }) {
  const gaps = report.evidence.gaps;
  if (gaps.length === 0) return null;
  return (
    <section aria-labelledby="gaps-heading">
      <h2 id="gaps-heading" className="mb-3 text-base font-semibold">
        {HEADING.gaps}
      </h2>
      <ul className="divide-y divide-report-line border-y border-report-line">
        {gaps.map((g, i) => {
          const first = Math.min(...g.seqs);
          return (
            <li key={i} id={gapAnchor(i)} className="scroll-mt-6 py-4 target:bg-report-accent-tint">
              <p className="flex items-start gap-2 text-base font-medium text-report-warning">
                <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={2.5} />
                {GAP_LABEL[g.code]}
              </p>
              <p className="mt-1 max-w-[62ch] break-words text-[15px] text-report-ink-2">{g.detail}</p>
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
