// What the system did, said in one line per action, and the raw record behind it.
import type { Evidence, Item } from "@/report/schema";
import { backendActionLine, eventLine, toolNoResultLine, toolResultLine } from "@/report/labels";

export type DidEntry = {
  /** The seqs this line stands for: a tool call and its result are one line. */
  seqs: number[];
  line: string;
  raw: unknown;
  backend: boolean;
};

type Call = Extract<Item, { kind: "tool_call" }>;
type Result = Extract<Item, { kind: "tool_result" }>;

/** The line for one tool call and, when it came back, its result. */
export function describeAction(call: Call, result: Result | undefined): DidEntry {
  return {
    seqs: result ? [call.seq, result.seq] : [call.seq],
    line: result ? toolResultLine(call.name, result.ok) : toolNoResultLine(call.name),
    raw: result ? { call: call.args, result: result.payload } : { call: call.args },
    backend: false,
  };
}

/** A tool call's result, found by the id they share. */
export function resultOf(evidence: Evidence, call: Call): Result | undefined {
  return evidence.items.find((x): x is Result => x.kind === "tool_result" && x.id === call.id);
}

/**
 * The lines for a list of seqs, in call order. A call and its result are one line, whichever of the two the list
 * names. Backend actions and events keep a line each. Turns are not something the system did, so they get none.
 */
export function describeActions(evidence: Evidence, seqs: number[]): DidEntry[] {
  const bySeq = new Map(evidence.items.map((it) => [it.seq, it]));
  const seen = new Set<string>();
  const entries: { at: number; entry: DidEntry }[] = [];
  for (const seq of seqs) {
    const item = bySeq.get(seq);
    if (!item) continue;
    if (item.kind === "tool_call" || item.kind === "tool_result") {
      const call = item.kind === "tool_call" ? item : evidence.items.find((x): x is Call => x.kind === "tool_call" && x.id === item.id);
      if (!call || seen.has(call.id)) continue;
      seen.add(call.id);
      entries.push({ at: call.seq, entry: describeAction(call, resultOf(evidence, call)) });
    } else if (item.kind === "backend_action") {
      entries.push({ at: item.seq, entry: { seqs: [item.seq], line: backendActionLine(item.tool, item.ok), raw: { args: item.args, result: item.result, ts: item.ts }, backend: true } });
    } else if (item.kind === "event") {
      entries.push({ at: item.seq, entry: { seqs: [item.seq], line: eventLine(item.type), raw: item.data, backend: false } });
    }
  }
  return entries.sort((a, b) => a.at - b.at).map((e) => e.entry);
}
