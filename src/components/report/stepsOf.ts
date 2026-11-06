// What to do next: the numbered steps. First the steps for each broken rule, in report order; then for each
// kind of review reason (an unanswered request, a deferral); then for each kind of gap. A rule, a reason kind or
// a gap kind gives its steps once however many times it shows up. A call that held has none. A rule's steps say
// what the system did not do as record fact only when the record proves it for every broken finding (absence.ts).
import type { CallReport, ContractResult, GapCode } from "@/report/schema";
import { GAP_NEXT_STEPS, NEXT_STEPS, PROVEN_NEXT_STEPS, REASON_NEXT_STEPS, type NextStep } from "@/report/labels";
import { everyAbsenceIsProven } from "./absence";

type ReasonSteps = typeof REASON_NEXT_STEPS;

export function nextStepsOf(report: CallReport, gapSteps: Partial<Record<GapCode, NextStep[]>> = GAP_NEXT_STEPS, reasonSteps: ReasonSteps = REASON_NEXT_STEPS): NextStep[] {
  const stepsFor = (c: ContractResult) => {
    const proven = PROVEN_NEXT_STEPS[c.contract];
    return proven && everyAbsenceIsProven(report.evidence, report.policy, c.contract, c.findings) ? proven : NEXT_STEPS[c.contract];
  };
  const broken = report.results.filter((c) => c.result === "violated").flatMap(stepsFor);
  const kinds = [...new Set(report.reasons.map((r) => r.kind))];
  const reasons = kinds.flatMap((kind) => (kind === "unverified_result" ? [] : (reasonSteps[kind] ?? [])));
  const codes = [...new Set(report.evidence.gaps.map((g) => g.code))];
  return [...broken, ...reasons, ...codes.flatMap((code) => gapSteps[code] ?? [])];
}
