// The rows the timeline shows. Display only: every item keeps its own seq and anchor, and the rows only say
// which items sit together. Adjacent turns by one speaker are one row, and a tool call and its result are one.
import type { Evidence, Item } from "@/report/schema";
import { describeAction, describeActions, resultOf, type DidEntry } from "./describe";

type Turn = Extract<Item, { kind: "turn" }>;

export type TimelineRow = { seqs: number[] } & ({ kind: "speech"; role: Turn["role"]; turns: Turn[] } | { kind: "action"; entry: DidEntry });

export function timelineRows(evidence: Evidence): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const merged = new Set<number>(); // result seqs already shown with their call
  for (const item of evidence.items) {
    if (merged.has(item.seq)) continue;
    if (item.kind === "turn") {
      const last = rows[rows.length - 1];
      if (last?.kind === "speech" && last.role === item.role) {
        last.turns.push(item);
        last.seqs.push(item.seq);
      } else rows.push({ kind: "speech", role: item.role, turns: [item], seqs: [item.seq] });
    } else if (item.kind === "tool_call") {
      const result = resultOf(evidence, item);
      if (result) merged.add(result.seq);
      const entry = describeAction(item, result);
      rows.push({ kind: "action", entry, seqs: entry.seqs });
    } else if (item.kind === "tool_result") {
      // A result whose call is not in the evidence: the schema forbids it, but show it rather than lose it.
      rows.push({ kind: "action", seqs: [item.seq], entry: { seqs: [item.seq], line: String(item.id), raw: item.payload, backend: false } });
    } else {
      const entry = describeActions(evidence, [item.seq])[0];
      rows.push({ kind: "action", entry, seqs: [item.seq] });
    }
  }
  return rows;
}
