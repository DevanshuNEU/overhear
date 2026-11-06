// When the record proves that the system did not do something. One guard for every place that says so: the Did
// lane, the steps and the lead. Where it does not hold, those places say what the engine found, never what the
// record shows. Pure functions, so the rule is tested without a browser.
import type { ContractId, Evidence, Finding, Policy } from "@/report/schema";

type Item = Evidence["items"][number];
type Turn = Extract<Item, { kind: "turn" }>;

// Gaps that mean the transcript does not hold every tool the call used.
const TOOL_LIST_GAPS = new Set<string>(["missing_tool_transcript", "unlinked_backend_action", "turn_index_out_of_range"]);

/**
 * True when the transcript's tool calls are every tool the call used: no gap says calls are missing or that the
 * backend did something the transcript does not hold, and every backend action names a tool the transcript called.
 */
export function toolListIsComplete(evidence: Evidence): boolean {
  if (evidence.gaps.some((g) => TOOL_LIST_GAPS.has(g.code))) return false;
  const called = new Set(evidence.items.flatMap((it) => (it.kind === "tool_call" ? [it.name] : [])));
  return evidence.items.every((it) => it.kind !== "backend_action" || called.has(it.tool));
}

const roleOf = (policy: Policy | undefined, name: string) => policy?.tools[name]?.role;

/**
 * True when the record shows no action of a kind (`is`) on one side of the claim. It is cautious: an action whose
 * tool the policy does not know, or an event named for a transfer, counts as possibly being of that kind.
 */
function noneOfKind(items: Item[], policy: Policy | undefined, side: (seq: number) => boolean, is: (role: string | undefined) => boolean, eventMatches: boolean): boolean {
  return !items.some((it) => {
    if (!side(it.seq)) return false;
    if (it.kind === "tool_call") return roleOf(policy, it.name) === undefined || is(roleOf(policy, it.name));
    if (it.kind === "backend_action") return roleOf(policy, it.tool) === undefined || is(roleOf(policy, it.tool));
    if (it.kind === "event") return eventMatches && /transfer/i.test(it.type);
    return false;
  });
}

/** The agent turn a finding's claim was made in, or null when it cites none. */
export function claimTurn(evidence: Evidence, finding: Finding): Turn | null {
  const turn = evidence.items.find((it): it is Turn => finding.said.includes(it.seq) && it.kind === "turn");
  return turn ?? null;
}

/**
 * True when the record proves the absence a broken finding rests on: for a transfer, that no transfer was tried
 * after the claim; for a promise, that no tool that changes a booking was called before it. That needs a complete
 * record in its own order: sequence ordering, no gaps at all, and a tool list that holds every tool the call used.
 * Any other rule, or a finding that did not break, proves nothing here.
 */
export function absenceIsProven(evidence: Evidence, policy: Policy | undefined, contract: ContractId, finding: Finding): boolean {
  if (contract !== "transfer_kept" && contract !== "promise_backed") return false;
  if (finding.result !== "violated" || evidence.ordering !== "sequence" || evidence.gaps.length > 0 || !toolListIsComplete(evidence)) return false;
  const claim = claimTurn(evidence, finding);
  if (!claim) return false;
  if (contract === "transfer_kept") return noneOfKind(evidence.items, policy, (s) => s > claim.seq, (r) => r === "transfer", true);
  return noneOfKind(evidence.items, policy, (s) => s < claim.seq, (r) => r === "change", false);
}

/** True when the record proves the absence for every broken finding of a rule, and the rule has at least one. */
export function everyAbsenceIsProven(evidence: Evidence, policy: Policy | undefined, contract: ContractId, findings: Finding[]): boolean {
  const broken = findings.filter((f) => f.result === "violated");
  return broken.length > 0 && broken.every((f) => absenceIsProven(evidence, policy, contract, f));
}
