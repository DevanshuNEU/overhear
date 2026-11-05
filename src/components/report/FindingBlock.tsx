// One finding: the sentence the engine wrote, the caller's request when there is one, then the
// said | did rows, then the compared details. Every lane is built from the finding's own seqs.
import { useId } from "react";
import type { ContractId, Detection, Evidence, Finding } from "@/report/schema";
import { FIELD_COLUMN_LABEL, FIELD_STATUS_LABEL, NOTHING_COMMITTED, capitalize, comparedLine } from "@/report/labels";
import { AskedLane, DidLane, SaidLane } from "./EvidenceLanes";

// The speech classes each contract's claim is made of. The schema applies the same mapping when it
// validates a report, so the words marked here are the words the verdict rests on.
const CLAIM_CLASSES: Partial<Record<ContractId, Detection["cls"][]>> = {
  promise_backed: ["completion"],
  spoken_matches_committed: ["completion"],
  transfer_kept: ["transfer", "tool_syntax"],
};

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
}: {
  finding: Finding;
  evidence: Evidence;
  detections: Detection[];
  contract: ContractId;
}) {
  const id = useId();
  const classes = CLAIM_CLASSES[contract] ?? [];
  const claims = detections.filter((d) => classes.includes(d.cls));
  const hasSaid = finding.said.length > 0;
  return (
    <article aria-labelledby={id} className="py-5 first:pt-0 last:pb-0">
      <p id={id} className="max-w-[62ch] text-base font-medium leading-snug">
        {finding.text}
      </p>
      {finding.asked.length > 0 ? (
        <div className="mt-4">
          <AskedLane evidence={evidence} seqs={finding.asked} />
        </div>
      ) : null}
      <div className={`mt-4 grid gap-6 ${hasSaid ? "md:grid-cols-2 md:gap-0 md:[&>*:first-child]:pr-8 md:[&>*:last-child]:border-l md:[&>*:last-child]:border-report-line md:[&>*:last-child]:pl-8" : ""}`}>
        {hasSaid ? <SaidLane evidence={evidence} seqs={finding.said} detections={claims} markClass={MARK_CLASS[finding.result]} /> : null}
        <DidLane evidence={evidence} seqs={finding.did} />
      </div>
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
            {finding.fields.map((f) => (
              <tr key={f.field} className="align-top">
                <th scope="row" className="border-b border-report-line py-2 pr-3 font-medium">{capitalize(f.field)}</th>
                <td className="break-words border-b border-report-line py-2 pr-3">{comparedLine(f.from, f.values)}</td>
                <td className="break-words border-b border-report-line py-2 pr-3">{f.committed ?? NOTHING_COMMITTED}</td>
                <td className={`border-b border-report-line py-2 ${f.status === "differs" ? "font-medium text-report-critical" : f.status === "unresolved" ? "font-medium text-report-warning" : ""}`}>
                  {FIELD_STATUS_LABEL[f.status]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}
