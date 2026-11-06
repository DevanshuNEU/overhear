// Threads: each finding is a thread through the call, made of the items it rests on. The timeline
// draws a rail for the threads that need attention (violated or unverified) and tags every item with
// the findings that cite it. Pure functions, so the rule is tested without a browser.
import type { CallReport, ContractId, Result } from "@/report/schema";
import { CONTRACT_TITLE, capitalize } from "@/report/labels";

export type Thread = {
  id: string;
  /** The id of the finding's block on the page, so an item can link back to it. */
  anchor: string;
  contract: ContractId;
  result: Result;
  label: string;
  /** Every seq the finding cites, once each, in call order. */
  seqs: number[];
  /** Whether the timeline draws a rail for it. */
  railed: boolean;
};

export type RailMark = { id: string; mark: "dot" | "line"; first: boolean; last: boolean };

/** The id of one finding's block: the contract and the finding's place in it. */
export function findingAnchor(contract: ContractId, index: number): string {
  return `finding-${contract}-${index}`;
}

export function threadsOf(report: CallReport): Thread[] {
  return report.results.flatMap((c) =>
    c.findings.map((f, i) => {
      const anchor = findingAnchor(c.contract, i);
      return {
        id: anchor,
        anchor,
        contract: c.contract,
        result: f.result,
        label: capitalize(CONTRACT_TITLE[c.contract]),
        seqs: [...new Set([...f.asked, ...f.said, ...f.did])].sort((a, b) => a - b),
        railed: f.result === "violated" || f.result === "unverified",
      };
    }),
  );
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
