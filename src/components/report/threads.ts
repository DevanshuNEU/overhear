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
  /** A finding's own sentence, which is how its claim is told from others on the same turn. Reasons and gaps have none. */
  text?: string;
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
        text: f.text,
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

/**
 * What each railed thread draws at each row of the timeline: a dot on a row that cites it, a line on the rows
 * between. A row can stand for several seqs (a tool call and its result are one row), so a thread's span is
 * read in rows, in the order they are shown.
 */
export function railMarks(threads: Thread[], rows: number[][]): RailMark[][] {
  const marks: RailMark[][] = rows.map(() => []);
  for (const t of threads) {
    if (!t.railed || t.seqs.length === 0) continue;
    const cited = rows.flatMap((row, i) => (row.some((s) => t.seqs.includes(s)) ? [i] : []));
    if (cited.length === 0) continue;
    const first = cited[0];
    const last = cited[cited.length - 1];
    for (let i = first; i <= last; i++) marks[i].push({ id: t.id, mark: cited.includes(i) ? "dot" : "line", first: i === first, last: i === last });
  }
  return marks;
}

/**
 * Which column of the rail area each railed thread draws in. The findings of one rule share a column, so their
 * dots line up down the page; reasons and gaps each have their own. Columns are numbered from zero, in the order
 * the rules first appear.
 */
export function railColumns(threads: Thread[]): Map<string, number> {
  const columns = new Map<string, number>();
  const byKey = new Map<string, number>();
  for (const t of threads) {
    if (!t.railed) continue;
    const key = t.contract ?? t.id;
    if (!byKey.has(key)) byKey.set(key, byKey.size);
    columns.set(t.id, byKey.get(key)!);
  }
  return columns;
}
