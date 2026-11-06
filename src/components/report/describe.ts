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
 * Which result answers which call. A result answers the latest earlier call with its id that is still waiting, so
 * a second result for one call, or two calls that share an id, never pair with the wrong thing.
 */
export function pairActions(evidence: Evidence): { resultFor: Map<number, Result>; callFor: Map<number, Call> } {
  const waiting = new Map<string, Call>();
  const resultFor = new Map<number, Result>();
  const callFor = new Map<number, Call>();
  for (const item of evidence.items) {
    if (item.kind === "tool_call") waiting.set(item.id, item);
    else if (item.kind === "tool_result") {
      const call = waiting.get(item.id);
      if (!call) continue;
      resultFor.set(call.seq, item);
      callFor.set(item.seq, call);
      waiting.delete(item.id);
    }
  }
  return { resultFor, callFor };
}

/** A result with no call waiting for it: a repeat answer to one call. It keeps its own line, named by the call it repeats. */
export function describeRepeatResult(evidence: Evidence, result: Result): DidEntry {
  const call = [...evidence.items].reverse().find((x): x is Call => x.kind === "tool_call" && x.id === result.id && x.seq < result.seq);
  return { seqs: [result.seq], line: toolResultLine(call?.name ?? result.id, result.ok), raw: { result: result.payload }, backend: false };
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
        entries.push({ at: call.seq, entry: describeAction(call, resultFor.get(call.seq)) });
      } else if (item.kind === "tool_result") entries.push({ at: item.seq, entry: describeRepeatResult(evidence, item) });
    } else if (item.kind === "backend_action") {
      entries.push({ at: item.seq, entry: { seqs: [item.seq], line: backendActionLine(item.tool, item.ok), raw: { args: item.args, result: item.result, ts: item.ts }, backend: true } });
    } else if (item.kind === "event") {
      entries.push({ at: item.seq, entry: { seqs: [item.seq], line: eventLine(item.type), raw: item.data, backend: false } });
    }
  }
  return entries.sort((a, b) => a.at - b.at).map((e) => e.entry);
}
