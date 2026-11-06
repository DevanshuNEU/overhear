// The rows the timeline shows. Display only: every item keeps its own seq and anchor, and the rows only say
// which items sit together. Adjacent turns by one speaker are one row. A tool call and its result are one row,
// shown where the result arrived, so what was said before the result stays above the outcome.
import type { Evidence, Item } from "@/report/schema";
import { describeAction, describeActions, describeRepeatResult, pairActions, type DidEntry } from "./describe";

type Turn = Extract<Item, { kind: "turn" }>;

export type TimelineRow = { seqs: number[] } & ({ kind: "speech"; role: Turn["role"]; turns: Turn[] } | { kind: "action"; entry: DidEntry });

export function timelineRows(evidence: Evidence): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const { resultFor, callFor } = pairActions(evidence);
  for (const item of evidence.items) {
    if (item.kind === "turn") {
      const last = rows[rows.length - 1];
      if (last?.kind === "speech" && last.role === item.role) {
        last.turns.push(item);
        last.seqs.push(item.seq);
      } else rows.push({ kind: "speech", role: item.role, turns: [item], seqs: [item.seq] });
    } else if (item.kind === "tool_call") {
      if (resultFor.has(item.seq)) continue; // shown with its result
      rows.push({ kind: "action", entry: describeAction(item, undefined), seqs: [item.seq] });
    } else if (item.kind === "tool_result") {
      const call = callFor.get(item.seq);
      const entry = call ? describeAction(call, item) : describeRepeatResult(evidence, item);
      rows.push({ kind: "action", entry, seqs: entry.seqs });
    } else {
      rows.push({ kind: "action", entry: describeActions(evidence, [item.seq])[0], seqs: [item.seq] });
    }
  }
  return rows;
}
