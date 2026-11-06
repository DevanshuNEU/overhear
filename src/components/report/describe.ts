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

export type Call = Extract<Item, { kind: "tool_call" }>;
export type Result = Extract<Item, { kind: "tool_result" }>;

/** The line for one tool call and, when it came back, its result. */
export function describeAction(call: Call, result: Result | undefined): DidEntry {
  return {
    seqs: result ? [call.seq, result.seq] : [call.seq],
    line: result ? toolResultLine(call.name, result.ok) : toolNoResultLine(call.name),
    raw: result ? { call: call.args, result: result.payload } : { call: call.args },
    backend: false,
  };
}

/**
 * Which result answers which call. A result answers the call with its id wherever the two sit in the record: with
 * timestamp order a result can come before its call. A call takes the first result for its id; a second result
 * for one call, or a call id shared by two calls, never pairs with the wrong thing.
 */
export function pairActions(evidence: Evidence): { resultFor: Map<number, Result>; callFor: Map<number, Call> } {
  const callsById = new Map<string, Call[]>();
  for (const it of evidence.items) if (it.kind === "tool_call") callsById.set(it.id, [...(callsById.get(it.id) ?? []), it]);
  const resultFor = new Map<number, Result>();
  const callFor = new Map<number, Call>();
  for (const item of evidence.items) {
    if (item.kind !== "tool_result") continue;
    // A call id shared by more than one call answers none of them for sure, so nothing is paired by it.
    const calls = callsById.get(item.id);
    if (calls?.length !== 1 || resultFor.has(calls[0].seq)) continue;
    resultFor.set(calls[0].seq, item);
    callFor.set(item.seq, calls[0]);
  }
  return { resultFor, callFor };
}

/** A result no call takes: a repeat answer to one call. It keeps its own line, named by the call when there is exactly one it can be. */
export function describeRepeatResult(evidence: Evidence, result: Result): DidEntry {
  const calls = evidence.items.filter((x): x is Call => x.kind === "tool_call" && x.id === result.id);
  const name = calls.length === 1 ? calls[0].name : result.id;
  return { seqs: [result.seq], line: toolResultLine(name, result.ok), raw: { result: result.payload }, backend: false };
}

/**
 * The lines for a list of seqs, in call order. A call and its result are one line, whichever of the two the list
 * names. Backend actions and events keep a line each. Turns are not something the system did, so they get none.
 */
export function describeActions(evidence: Evidence, seqs: number[]): DidEntry[] {
  const bySeq = new Map(evidence.items.map((it) => [it.seq, it]));
  const { resultFor, callFor } = pairActions(evidence);
  const seen = new Set<number>();
  const entries: { at: number; entry: DidEntry }[] = [];
  for (const seq of seqs) {
    const item = bySeq.get(seq);
    if (!item) continue;
    if (item.kind === "tool_call" || item.kind === "tool_result") {
      const call = item.kind === "tool_call" ? item : callFor.get(item.seq);
      if (call) {
        if (seen.has(call.seq)) continue;
        seen.add(call.seq);
        // Placed by whichever of the two came first, so the lines stay in the order the call made them.
        const result = resultFor.get(call.seq);
        entries.push({ at: Math.min(call.seq, result?.seq ?? call.seq), entry: describeAction(call, result) });
      } else if (item.kind === "tool_result") entries.push({ at: item.seq, entry: describeRepeatResult(evidence, item) });
    } else if (item.kind === "backend_action") {
      entries.push({ at: item.seq, entry: { seqs: [item.seq], line: backendActionLine(item.tool, item.ok), raw: { args: item.args, result: item.result, ts: item.ts }, backend: true } });
    } else if (item.kind === "event") {
      entries.push({ at: item.seq, entry: { seqs: [item.seq], line: eventLine(item.type), raw: item.data, backend: false } });
    }
  }
  return entries.sort((a, b) => a.at - b.at).map((e) => e.entry);
}
