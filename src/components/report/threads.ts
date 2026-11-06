// Threads: each finding is a thread through the call, made of the items it rests on. The timeline
// draws a rail for the threads that need attention (violated or unverified) and tags every item with
// the findings that cite it. Pure functions, so the rule is tested without a browser.
import type { CallReport, ContractId, Result } from "@/report/schema";
import { CONTRACT_TITLE, GAP_LABEL, REASON_TAG, capitalize, numberedLabel } from "@/report/labels";

export type Thread = {
  id: string;
  /** The id of the finding's block on the page, so an item can link back to it. */
  anchor: string;
  /** The contract a finding belongs to. Reasons and gaps have none. */
  contract?: ContractId;
  result: Result;
  label: string;
  /** Every seq the finding cites, once each, in call order. */
  seqs: number[];
  /** Whether the timeline draws a rail for it. */
  railed: boolean;
};

export type RailMark = { id: string; mark: "dot" | "line"; first: boolean; last: boolean };

/** The id of one finding's block: the contract and the finding's place in it. */
export const reasonAnchor = (index: number) => `reason-${index}`;
export const gapAnchor = (index: number) => `gap-${index}`;
/** The id of one rule's section. */
export const contractAnchor = (contract: ContractId) => `contract-${contract}`;

export function findingAnchor(contract: ContractId, index: number): string {
  return `finding-${contract}-${index}`;
}

const sortedSeqs = (seqs: number[]) => [...new Set(seqs)].sort((x, y) => x - y);

/**
 * Findings first, then the review reasons that name something of their own (a deferral or an unanswered
 * request), then the gaps. A reason that an unverified result gave only repeats that rule's finding, so it
 * has no thread. Reasons and gaps are numbered by their place in the report, as their anchors are.
 */
export function threadsOf(report: CallReport): Thread[] {
  const findings = report.results.flatMap((c) =>
    c.findings.map((f, i): Thread => {
      const anchor = findingAnchor(c.contract, i);
      const title = capitalize(CONTRACT_TITLE[c.contract]);
      const seqs = sortedSeqs([...f.asked, ...f.said, ...f.did]);
      return {
        id: anchor,
        anchor,
        contract: c.contract,
        result: f.result,
        label: c.findings.length > 1 ? numberedLabel(title, i + 1, c.findings.length) : title,
        seqs,
        railed: seqs.length > 0 && (f.result === "violated" || f.result === "unverified"),
      };
    }),
  );
  const reasons = report.reasons.flatMap((r, i): Thread[] => {
    if (r.kind === "unverified_result") return [];
    const seqs = sortedSeqs(r.seqs);
    return [{ id: reasonAnchor(i), anchor: reasonAnchor(i), result: "unverified", label: REASON_TAG[r.kind], seqs, railed: seqs.length > 0 }];
  });
  const gaps = report.evidence.gaps.map(
    (g, i): Thread => ({ id: gapAnchor(i), anchor: gapAnchor(i), result: "unverified", label: GAP_LABEL[g.code], seqs: sortedSeqs(g.seqs), railed: false }),
  );
  return [...findings, ...reasons, ...gaps];
}

/** What each railed thread draws at one item: a dot where the thread cites it, a line where it passes by. */
export function railsAt(threads: Thread[], seq: number): RailMark[] {
  return threads.flatMap((t) => {
    if (!t.railed || t.seqs.length === 0) return [];
    const first = t.seqs[0];
    const last = t.seqs[t.seqs.length - 1];
    if (seq < first || seq > last) return [];
    return [{ id: t.id, mark: t.seqs.includes(seq) ? ("dot" as const) : ("line" as const), first: seq === first, last: seq === last }];
  });
}
