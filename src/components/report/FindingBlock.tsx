// One finding: the sentence the engine wrote, the caller's request when there is one, then the
// said | did rows, then the compared details. Every lane is built from the finding's own seqs.
import { useId } from "react";
import type { ContractId, Detection, Evidence, Finding, Policy } from "@/report/schema";
import { citedClaims } from "./claims";
import { FIELD_COLUMN_LABEL, NOTHING_COMMITTED, SHOW_IN_CALL, capitalize, comparedLine, fieldStatusLabel } from "@/report/labels";
import { AbsenceProof } from "./AbsenceProof";
import { LaneRows } from "./LaneRows";

const MARK_CLASS = {
  violated: "bg-report-critical-mark",
  unverified: "bg-report-warning-mark",
  passed: "bg-report-calm-mark",
} as const;

export function FindingBlock({
  finding,
  evidence,
  detections,
  contract,
  policy,
  anchor,
  hideText = false,
}: {
  finding: Finding;
  evidence: Evidence;
  detections: Detection[];
  contract: ContractId;
  /** The policy that names which tools transfer or change a booking, so an absence can be proved. */
  policy?: Policy;
  /** The id other parts of the page link to: the timeline's tags point here. */
  anchor?: string;
  /** The lead above has said this finding's sentence word for word, so only a screen reader still gets it here. */
  hideText?: boolean;
}) {
  const id = useId();
  const claims = citedClaims(finding, contract, detections);
  const firstSeq = Math.min(...finding.asked, ...finding.said, ...finding.did);
  // Under the sentence; or, when the sentence is hidden, after the evidence rather than alone under the heading.
  const link = Number.isFinite(firstSeq) ? (
    <a
      href={`#item-${firstSeq}`}
      aria-describedby={id}
      className="mt-2 inline-block rounded py-1 text-[13px] text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
    >
      {SHOW_IN_CALL}
    </a>
  ) : null;
  return (
    <article id={anchor} aria-labelledby={id} className="scroll-mt-6 py-5 first:pt-0 last:pb-0 target:rounded-md target:bg-report-accent-tint target:ring-8 target:ring-report-accent-tint">
      <p id={id} className={hideText ? "sr-only" : "max-w-[62ch] break-words text-base font-medium leading-snug"}>
        {finding.text}
      </p>
      {hideText ? null : link}
      <LaneRows
        evidence={evidence}
        asked={finding.asked}
        said={finding.said}
        did={finding.did}
        detections={claims}
        markClass={MARK_CLASS[finding.result]}
        showEmptyDid
        absence={<AbsenceProof evidence={evidence} policy={policy} contract={contract} finding={finding} />}
      />
      {hideText ? link : null}
      {finding.fields.length > 0 ? (
        <table className="mt-5 w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="text-[13px] font-medium text-report-muted">
              <th scope="col" className="w-[22%] border-b border-report-line py-2 pr-3 font-medium">{FIELD_COLUMN_LABEL.field}</th>
              <th scope="col" className="border-b border-report-line py-2 pr-3 font-medium">{FIELD_COLUMN_LABEL.compared}</th>
              <th scope="col" className="border-b border-report-line py-2 pr-3 font-medium">{FIELD_COLUMN_LABEL.committed}</th>
              <th scope="col" className="w-[24%] border-b border-report-line py-2 font-medium">{FIELD_COLUMN_LABEL.status}</th>
            </tr>
          </thead>
          <tbody>
            {finding.fields.map((f, i) => (
              <tr key={i} className="align-top">
                <th scope="row" className="min-w-0 [overflow-wrap:anywhere] border-b border-report-line py-2 pr-3 font-medium">{capitalize(f.field)}</th>
                <td className="[overflow-wrap:anywhere] border-b border-report-line py-2 pr-3">{comparedLine(f.from, f.values)}</td>
                <td className="[overflow-wrap:anywhere] border-b border-report-line py-2 pr-3">{f.committed ?? NOTHING_COMMITTED}</td>
                <td className={`border-b border-report-line py-2 ${f.status === "differs" ? "font-medium text-report-critical" : f.status === "unresolved" ? "font-medium text-report-warning" : ""}`}>
                  {fieldStatusLabel(f)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}
