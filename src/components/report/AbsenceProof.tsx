// The Did lane when a finding rests on something the system did not do. It says what the record shows:
// that no tool of the right kind was called, and which tools the call did use. It claims an absence only
// when the record can bear it out, and otherwise falls back to a plain statement and says no more.
import type { ContractId, Evidence, Finding, Policy } from "@/report/schema";
import { NOTHING_DID, noChangeBefore, noTransferAfter, toolsCalledLine } from "@/report/labels";
import { formatClock } from "./format";

type Item = Evidence["items"][number];

const rolesOf = (policy: Policy | undefined, name: string) => policy?.tools[name]?.role;

/**
 * True when the record shows no action of a kind (`is`) on the far side of the claim. It is cautious: an action
 * whose tool the policy does not know, or an event named for a transfer, counts as possibly being of that kind.
 */
function noneOfKind(items: Item[], policy: Policy | undefined, side: (seq: number) => boolean, is: (role: string | undefined) => boolean, eventMatches: boolean): boolean {
  return !items.some((it) => {
    if (!side(it.seq)) return false;
    if (it.kind === "tool_call") return rolesOf(policy, it.name) === undefined || is(rolesOf(policy, it.name));
    if (it.kind === "backend_action") return rolesOf(policy, it.tool) === undefined || is(rolesOf(policy, it.tool));
    if (it.kind === "event") return eventMatches && /transfer/i.test(it.type);
    return false;
  });
}

function firstProofLine(evidence: Evidence, policy: Policy | undefined, contract: ContractId, finding: Finding): string | null {
  // An absence can only be shown from a complete, ordered record, for a finding that is broken.
  if (finding.result !== "violated" || evidence.ordering !== "sequence" || evidence.gaps.length > 0) return null;
  const claim = evidence.items.find((it) => finding.said.includes(it.seq) && it.kind === "turn");
  if (!claim) return null;
  const clock = claim.kind === "turn" && claim.startSec !== null ? formatClock(claim.startSec) : null;
  if (contract === "transfer_kept") {
    return noneOfKind(evidence.items, policy, (s) => s > claim.seq, (r) => r === "transfer", true) ? noTransferAfter(clock) : null;
  }
  if (contract === "promise_backed") {
    return noneOfKind(evidence.items, policy, (s) => s < claim.seq, (r) => r === "change", false) ? noChangeBefore(clock) : null;
  }
  return null;
}

export function AbsenceProof({ evidence, policy, contract, finding }: { evidence: Evidence; policy?: Policy; contract: ContractId; finding: Finding }) {
  const names = [...new Set(evidence.items.flatMap((it) => (it.kind === "tool_call" ? [it.name] : [])))];
  // With the tool transcript missing, the list of tools would read as complete and is not.
  const listIsTrustworthy = !evidence.gaps.some((g) => g.code === "missing_tool_transcript");
  return (
    <div className="space-y-1.5 text-[15px] text-report-ink-2">
      <p>{firstProofLine(evidence, policy, contract, finding) ?? NOTHING_DID}</p>
      {listIsTrustworthy ? <p>{toolsCalledLine(names)}</p> : null}
    </div>
  );
}
