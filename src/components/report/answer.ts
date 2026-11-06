// The answer: the one sentence the screen leads with. It is built only from what the engine wrote, the
// top broken finding's own sentence or the first review reason's, plus a count. It is never a claim of ours.
import type { CallReport } from "@/report/schema";
import { repeatedLine, uncheckedCountLine } from "@/report/labels";

export function answerOf(report: CallReport): string | null {
  if (report.verdict === "failed") {
    const contract = report.results.find((c) => c.findings.some((f) => f.result === "violated"));
    if (!contract) return null;
    const broken = contract.findings.filter((f) => f.result === "violated");
    return broken.length > 1 ? [broken[0].text, repeatedLine(broken.length)].filter(Boolean).join(" ") : broken[0].text;
  }
  if (report.verdict === "needs_review") {
    const first = report.reasons[0];
    if (!first) return null;
    const unchecked = new Set(report.reasons.flatMap((r) => (r.kind === "unverified_result" && r.contract ? [r.contract] : [])));
    return first.kind === "unverified_result" && unchecked.size > 1 ? `${first.text} ${uncheckedCountLine(unchecked.size)}` : first.text;
  }
  return null;
}
