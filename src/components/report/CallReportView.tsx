// The call detail screen for one report. It reads only the report it is given: the stored headline,
// the contract results, and the evidence the findings point into.
import type { CallReport, ContractResult, Result } from "@/report/schema";
import { CONTRACT_TITLE, HEADING, RESULT_LABEL, capitalize } from "@/report/labels";
import { ContractSection } from "./ContractSection";
import { ReportHeader } from "./ReportHeader";

const SHOWN: Result[] = ["violated", "unverified", "passed"];

/** Broken first, then unchecked, then held. Contracts that did not apply or did not run are listed apart. */
function sortedForReading(results: ContractResult[]): ContractResult[] {
  return SHOWN.flatMap((r) => results.filter((c) => c.result === r));
}

export function CallReportView({ report }: { report: CallReport }) {
  const shown = sortedForReading(report.results);
  const skipped = report.results.filter((c) => !SHOWN.includes(c.result));
  return (
    <div className="space-y-12">
      <ReportHeader report={report} />
      {shown.length > 0 ? (
        <section aria-labelledby="rows-heading">
          <h2 id="rows-heading" className="mb-4 text-base font-semibold">
            {HEADING.rows}
          </h2>
          <div className="border-b border-report-line">
            {shown.map((c) => (
              <ContractSection key={c.contract} contract={c} evidence={report.evidence} detections={report.detections} />
            ))}
          </div>
        </section>
      ) : null}
      {skipped.length > 0 ? (
        <section aria-labelledby="other-heading">
          <h2 id="other-heading" className="mb-3 text-base font-semibold">
            {HEADING.otherRules}
          </h2>
          <ul className="divide-y divide-report-line border-y border-report-line">
            {skipped.map((c) => (
              <li key={c.contract} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3 text-sm">
                <span>{capitalize(CONTRACT_TITLE[c.contract])}</span>
                <span className="text-report-muted">{RESULT_LABEL[c.result]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
