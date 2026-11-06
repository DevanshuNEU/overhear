// The answer: the one sentence the screen leads with. It is built only from what the engine wrote and from
// counts and times in its findings: one finding or reason gives its own sentence; a rule that broke more than
// once gives a template from labels.ts, filled with the count and the times. It never states a claim of ours:
// a template says what the system did not do as fact only when the record proves it (absence.ts).
import type { CallReport, ContractId } from "@/report/schema";
import { LEAD_TEMPLATES, repeatedLine, uncheckedCountLine } from "@/report/labels";
import { everyAbsenceIsProven } from "./absence";
import { formatClock } from "./format";

/** Where the answer's words came from, so the section below can leave out a sentence the lead has already said. */
export type AnswerSource = { kind: "finding"; contract: ContractId; index: number } | { kind: "reason"; index: number } | { kind: "template" };

export type Answer = { text: string; source: AnswerSource };

export function answerOf(report: CallReport, templates: typeof LEAD_TEMPLATES = LEAD_TEMPLATES): Answer | null {
  if (report.verdict === "failed") {
    const contract = report.results.find((c) => c.findings.some((f) => f.result === "violated"));
    if (!contract) return null;
    const broken = contract.findings.flatMap((f, index) => (f.result === "violated" ? [{ f, index }] : []));
    if (broken.length === 1) return { text: broken[0].f.text, source: { kind: "finding", contract: contract.contract, index: broken[0].index } };
    const template = templates[contract.contract];
    if (template) {
      const times = broken.map(({ f }) => {
        const turn = report.evidence.items.find((it) => it.kind === "turn" && f.said.includes(it.seq));
        return turn && turn.kind === "turn" && turn.startSec !== null ? formatClock(turn.startSec) : null;
      });
      const proven = everyAbsenceIsProven(report.evidence, report.policy, contract.contract, contract.findings);
      return { text: template(broken.length, times.every((t): t is string => t !== null) ? times : [], proven), source: { kind: "template" } };
    }
    return { text: [broken[0].f.text, repeatedLine(broken.length)].filter(Boolean).join(" "), source: { kind: "template" } };
  }
  if (report.verdict === "needs_review") {
    const first = report.reasons[0];
    if (!first) return null;
    const unchecked = new Set(report.reasons.flatMap((r) => (r.kind === "unverified_result" && r.contract ? [r.contract] : [])));
    const text = first.kind === "unverified_result" && unchecked.size > 1 ? `${first.text} ${uncheckedCountLine(unchecked.size)}` : first.text;
    return { text, source: { kind: "reason", index: 0 } };
  }
  return null;
}
