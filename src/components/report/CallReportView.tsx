// The call detail screen for one report. It reads only the report it is given: the stored headline,
// the contract results, and the evidence the findings point into.
import type { CallReport, ContractResult, Result } from "@/report/schema";
import { ChevronRight } from "lucide-react";
import { CONTRACT_TITLE, HEADING, capitalize, ruleCountLine } from "@/report/labels";
import { CallTimeline } from "./CallTimeline";
import { ContractSection } from "./ContractSection";
import { GapsSection } from "./GapsSection";
import { NextSteps } from "./NextSteps";
import { OpenTarget } from "./OpenTarget";
import { nextStepsOf } from "./stepsOf";
import { answerOf } from "./answer";
import { ReasonsSection } from "./ReasonsSection";
import { ReportHeader } from "./ReportHeader";

const SHOWN: Result[] = ["violated", "unverified", "passed"];

/** Broken first, then unchecked, then held. Contracts that did not apply or did not run are listed apart. */
function sortedForReading(results: ContractResult[]): ContractResult[] {
  return SHOWN.flatMap((r) => results.filter((c) => c.result === r));
}

export function CallReportView({ report }: { report: CallReport }) {
  const shown = sortedForReading(report.results);
  const skipped = report.results.filter((c) => !SHOWN.includes(c.result));
  const answer = answerOf(report);
  const src = answer?.source;
  const leadReason = src?.kind === "reason" ? src.index : undefined;
  const hasSteps = nextStepsOf(report).length > 0;
  return (
    <div className="space-y-12">
      <OpenTarget />
      <ReportHeader report={report} />
      {/* With steps to show: under the answer in a narrow window, and in a right column at 1280 and wider. */}
      <div className={hasSteps ? "space-y-12 xl:grid xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start xl:gap-x-14 xl:space-y-0" : "max-w-[1040px]"}>
        <NextSteps report={report} className="xl:order-2 xl:sticky xl:top-6" />
        <div className="min-w-0 space-y-12">
          <ReasonsSection report={report} leadReason={leadReason} />
          <GapsSection report={report} saidInLead={leadReason === undefined ? undefined : report.reasons[leadReason].text} />
          {shown.length > 0 ? (
            <section aria-labelledby="rows-heading">
              <h2 id="rows-heading" className="mb-4 text-base font-semibold">
                {HEADING.rows}
              </h2>
              <div className="border-b border-report-line">
                {shown.map((c) => (
                  <ContractSection key={c.contract} contract={c} evidence={report.evidence} detections={report.detections} policy={report.policy} leadFinding={src?.kind === "finding" && src.contract === c.contract ? src.index : undefined} />
                ))}
              </div>
            </section>
          ) : null}
          {skipped.length > 0 ? (
            <section aria-labelledby="other-heading">
              <h2 id="other-heading" className="mb-3 text-base font-semibold">
                {HEADING.otherRules}
              </h2>
              {/* One result, one line: a count that opens to the rules. */}
              <div className="divide-y divide-report-line border-y border-report-line">
                {(["not_run", "not_applicable"] as const).map((result) => {
                  const group = skipped.filter((c) => c.result === result);
                  if (group.length === 0) return null;
                  return (
                    <details key={result} className="group">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-md py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent [&::-webkit-details-marker]:hidden">
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-report-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                        {ruleCountLine(result, group.length)}
                      </summary>
                      <ul className="pb-3 pl-7 text-sm text-report-ink-2">
                        {group.map((c) => (
                          <li key={c.contract} className="py-1">
                            {capitalize(CONTRACT_TITLE[c.contract])}
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                })}
              </div>
            </section>
          ) : null}
          <CallTimeline report={report} />
        </div>
      </div>
    </div>
  );
}
