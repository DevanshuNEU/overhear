// What to do next: the numbered steps for what broke. Steps for a broken rule come first, in report order, then
// steps for gaps. A rule or a gap kind gives its steps once however many times it shows up.
import type { CallReport, GapCode } from "@/report/schema";
import { GAP_NEXT_STEPS, NEXT_STEPS, type NextStep } from "@/report/labels";

export function nextStepsOf(report: CallReport, gapSteps: Partial<Record<GapCode, NextStep[]>> = GAP_NEXT_STEPS): NextStep[] {
  const broken = report.results.filter((c) => c.result === "violated").flatMap((c) => NEXT_STEPS[c.contract]);
  const codes = [...new Set(report.evidence.gaps.map((g) => g.code))];
  return [...broken, ...codes.flatMap((code) => gapSteps[code] ?? [])];
}
