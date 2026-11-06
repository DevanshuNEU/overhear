// The Did lane when a finding rests on something the system did not do. It says what the record shows:
// that no tool of the right kind was called, and which tools the call did use. It claims an absence only
// when the record bears it out, and otherwise falls back to a plain statement.
import type { ContractId, Evidence, Finding, Policy } from "@/report/schema";
import { NOTHING_DID, noChangeBefore, noTransferAfter, toolsCalledLine } from "@/report/labels";
import { formatClock } from "./format";

type Call = Extract<Evidence["items"][number], { kind: "tool_call" }>;

/** The tools a policy gives a role: "transfer" for the tools that hand the caller on, "change" for those that alter a booking. */
function namesWithRole(policy: Policy | undefined, role: "transfer" | "change"): Set<string> {
  return new Set(Object.entries(policy?.tools ?? {}).flatMap(([name, t]) => (t.role === role ? [name] : [])));
}

function firstProofLine(evidence: Evidence, policy: Policy | undefined, contract: ContractId, finding: Finding): string | null {
  const claim = evidence.items.find((it) => finding.said.includes(it.seq) && it.kind === "turn");
  if (!claim) return null;
  const clock = claim.kind === "turn" && claim.startSec !== null ? formatClock(claim.startSec) : null;
  const calls = evidence.items.filter((it): it is Call => it.kind === "tool_call");
  if (contract === "transfer_kept") {
    const transfer = namesWithRole(policy, "transfer");
    return calls.some((c) => transfer.has(c.name) && c.seq > claim.seq) ? null : noTransferAfter(clock);
  }
  if (contract === "promise_backed") {
    const change = namesWithRole(policy, "change");
    return calls.some((c) => change.has(c.name) && c.seq < claim.seq) ? null : noChangeBefore(clock);
  }
  return null;
}

export function AbsenceProof({ evidence, policy, contract, finding }: { evidence: Evidence; policy?: Policy; contract: ContractId; finding: Finding }) {
  const names = [...new Set(evidence.items.flatMap((it) => (it.kind === "tool_call" ? [it.name] : [])))];
  return (
    <div className="space-y-1.5 text-[15px] text-report-ink-2">
      <p>{firstProofLine(evidence, policy, contract, finding) ?? NOTHING_DID}</p>
      <p>{toolsCalledLine(names)}</p>
    </div>
  );
}
