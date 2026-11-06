// Why a call needs review, beneath the headline. A reason that names something of its own (a deferral, an
// unanswered request) gets its sentence and the items it rests on. Rules that could not be checked are
// named once and linked, because each rule's section already says why.
import { useId } from "react";
import type { CallReport } from "@/report/schema";
import { CONTRACT_TITLE, COULDNT_CHECK_LEAD, HEADING, SHOW_IN_CALL, capitalize } from "@/report/labels";
import { LaneRows } from "./LaneRows";
import { contractAnchor, reasonAnchor } from "./threads";

function ReasonBlock({ report, index }: { report: CallReport; index: number }) {
  const id = useId();
  const reason = report.reasons[index];
  const first = Math.min(...reason.seqs);
  return (
    <article id={reasonAnchor(index)} aria-labelledby={id} className="scroll-mt-6 py-5 first:pt-0 last:pb-0 target:rounded-md target:bg-report-accent-tint target:ring-8 target:ring-report-accent-tint">
      <p id={id} className="max-w-[62ch] break-words text-base font-medium leading-snug">
        {reason.text}
      </p>
      {Number.isFinite(first) ? (
        <a
          href={`#item-${first}`}
          aria-describedby={id}
          className="mt-1 inline-block rounded py-1 text-[13px] text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
        >
          {SHOW_IN_CALL}
        </a>
      ) : null}
      <LaneRows evidence={report.evidence} asked={reason.seqs} said={reason.seqs} did={reason.seqs} detections={[]} markClass="bg-report-warning-mark" showEmptyDid={false} />
    </article>
  );
}

export function ReasonsSection({ report }: { report: CallReport }) {
  if (report.verdict !== "needs_review" || report.reasons.length === 0) return null;
  const named = report.reasons.flatMap((r, i) => (r.kind === "unverified_result" ? [] : [i]));
  const unchecked = [...new Set(report.reasons.flatMap((r) => (r.kind === "unverified_result" && r.contract ? [r.contract] : [])))];
  return (
    <section aria-labelledby="reasons-heading">
      <h2 id="reasons-heading" className="mb-4 text-base font-semibold">
        {HEADING.reasons}
      </h2>
      <div className="divide-y divide-report-line border-y border-report-line py-5">
        {named.map((i) => (
          <ReasonBlock key={i} report={report} index={i} />
        ))}
        {unchecked.length > 0 ? (
          <p className="text-[15px] leading-relaxed first:pt-0 [&:not(:first-child)]:pt-5">
            <span className="font-medium text-report-warning">{COULDNT_CHECK_LEAD}</span>{" "}
            {unchecked.map((c, i) => (
              <span key={c}>
                {i > 0 ? ", " : ""}
                <a href={`#${contractAnchor(c)}`} className="text-report-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent">
                  {capitalize(CONTRACT_TITLE[c])}
                </a>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </section>
  );
}
