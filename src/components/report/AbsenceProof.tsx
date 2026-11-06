// The Did lane when a finding rests on something the system did not do. It says what the record shows:
// that no tool of the right kind was called, and which tools the call did use. It claims an absence only
// when the record can bear it out (absence.ts), and otherwise falls back to a plain statement and says no more.
import type { ContractId, Evidence, Finding, Policy } from "@/report/schema";
import { NOTHING_DID, noChangeBefore, noTransferAfter, toolsCalledLine } from "@/report/labels";
import { absenceIsProven, claimTurn, toolListIsComplete } from "./absence";
import { formatClock } from "./format";

function proofLine(evidence: Evidence, policy: Policy | undefined, contract: ContractId, finding: Finding): string | null {
  if (!absenceIsProven(evidence, policy, contract, finding)) return null;
  const claim = claimTurn(evidence, finding);
  const clock = claim && claim.startSec !== null ? formatClock(claim.startSec) : null;
  return contract === "transfer_kept" ? noTransferAfter(clock) : noChangeBefore(clock);
}

export function AbsenceProof({ evidence, policy, contract, finding }: { evidence: Evidence; policy?: Policy; contract: ContractId; finding: Finding }) {
  const names = [...new Set(evidence.items.flatMap((it) => (it.kind === "tool_call" ? [it.name] : [])))];
  const proof = proofLine(evidence, policy, contract, finding);
  // The list reads as every tool the call used, so it shows only when it is. An empty list says no tools were
  // called at all, which is an absence too, so it needs the same proof as the line above it.
  const showList = toolListIsComplete(evidence) && (names.length > 0 || proof !== null);
  return (
    <div className="space-y-1.5 text-[15px] text-report-ink-2">
      <p>{proof ?? NOTHING_DID}</p>
      {showList ? <p>{toolsCalledLine(names)}</p> : null}
    </div>
  );
}
