// Why a call needs review, beneath the headline. A reason that names something of its own (a deferral, an
// unanswered request) gets its sentence and the items it rests on. Rules that could not be checked are
// named once and linked, because each rule's section already says why.
import { useId } from "react";
import type { CallReport } from "@/report/schema";
import { HEADING, SHOW_IN_CALL } from "@/report/labels";
import { LaneRows } from "./LaneRows";
import { reasonAnchor } from "./threads";

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
  if (report.verdict !== "needs_review") return null;
  // Reasons that name something of their own. A rule that could not be checked is said once, under "What we couldn't
  // check", so its reason is left out only when a gap there already says the same words. Any other wording is kept.
  const saidByGap = (text: string) => report.evidence.gaps.some((g) => g.detail === text);
  const named = report.reasons.flatMap((r, i) => (r.kind === "unverified_result" && saidByGap(r.text) ? [] : [i]));
  if (named.length === 0) return null;
  return (
    <section aria-labelledby="reasons-heading">
      <h2 id="reasons-heading" className="mb-4 text-base font-semibold">
        {HEADING.reasons}
      </h2>
      <div className="divide-y divide-report-line border-y border-report-line py-5">
        {named.map((i) => (
          <ReasonBlock key={i} report={report} index={i} />
        ))}
      </div>
    </section>
  );
}
