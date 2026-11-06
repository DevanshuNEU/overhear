// One contract and its findings. A broken or unchecked contract is open on the page; one that held
// is a single line that opens on request.
import { useId } from "react";
import { ChevronRight } from "lucide-react";
import type { ContractResult, Detection, Evidence, Policy } from "@/report/schema";
import { CONTRACT_TITLE, SEE_GAPS, capitalize } from "@/report/labels";
import { FindingBlock } from "./FindingBlock";
import { ResultBadge } from "./StatusBadge";
import { contractAnchor, findingAnchor } from "./threads";

export function ContractSection({ contract, evidence, detections, policy }: { contract: ContractResult; evidence: Evidence; detections: Detection[]; policy?: Policy }) {
  const id = useId();
  const title = capitalize(CONTRACT_TITLE[contract.contract]);
  const findings = (
    <div className="divide-y divide-report-line">
      {contract.findings.map((f, i) => (
        <FindingBlock key={i} finding={f} evidence={evidence} detections={detections} contract={contract.contract} policy={policy} anchor={findingAnchor(contract.contract, i)} />
      ))}
    </div>
  );

  if (contract.result === "passed") {
    return (
      <section id={contractAnchor(contract.contract)} aria-labelledby={id} className="scroll-mt-6 border-t border-report-line">
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-md py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 shrink-0 text-report-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            <h3 id={id} className="min-w-0 flex-1 text-base font-medium">
              {title}
            </h3>
            <ResultBadge result={contract.result} />
          </summary>
          <div className="pb-6 pl-7">{findings}</div>
        </details>
      </section>
    );
  }

  return (
    <section id={contractAnchor(contract.contract)} aria-labelledby={id} className="scroll-mt-6 border-t border-report-line pb-8 pt-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={id} className="text-xl font-semibold tracking-[-0.01em]">
          {title}
        </h3>
        <ResultBadge result={contract.result} />
      </div>
      {contract.result === "unverified" && evidence.gaps.length > 0 ? (
        <p className="-mt-2 mb-5 text-sm">
          <a href="#gaps" className="text-report-warning underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent">
            {SEE_GAPS}
          </a>
        </p>
      ) : null}
      {findings}
    </section>
  );
}
