// The one rule that pairs a tool result with its call. resolveOk (which judges a result by its call's tool) and
// toolCalls (which hands a call its result) both read the pairing from here, so they cannot disagree about which
// call a result answers. Pure: the items are not changed.
import type { Item } from "@/report/schema";

export type ToolCall = Extract<Item, { kind: "tool_call" }>;
export type ToolResult = Extract<Item, { kind: "tool_result" }>;

export interface ToolPairing {
  /** Every call, in seq order. */
  calls: ToolCall[];
  /** Every result, in seq order. */
  results: ToolResult[];
  /** The result that answers a call, or undefined when none came back. */
  resultOf(call: ToolCall): ToolResult | undefined;
  /** The call a result answers, or undefined when no earlier unanswered call has its id. */
  callOf(result: ToolResult): ToolCall | undefined;
}

/**
 * A result answers the nearest earlier call with its id that no result has answered yet. So a reused id pairs each
 * result with the call just before it, and two calls with one id in flight are answered one result each, the nearer
 * call first (which of two such calls a result belongs to is a guess; each is paired once). A result with no earlier
 * unanswered call, such as a second result for one call or a result that came first, is unpaired, as is a call no
 * result answers. Items are read in seq order, whatever order they arrive in.
 */
export function pairToolItems(items: readonly Item[]): ToolPairing {
  const ordered = [...items].sort((a, b) => a.seq - b.seq);
  const calls: ToolCall[] = [];
  const results: ToolResult[] = [];
  const open = new Map<string, ToolCall[]>();
  const resultByCall = new Map<number, ToolResult>();
  const callByResult = new Map<number, ToolCall>();
  for (const it of ordered) {
    if (it.kind === "tool_call") {
      calls.push(it);
      const stack = open.get(it.id);
      if (stack) stack.push(it);
      else open.set(it.id, [it]);
    } else if (it.kind === "tool_result") {
      results.push(it);
      const call = open.get(it.id)?.pop();
      if (call) {
        resultByCall.set(call.seq, it);
        callByResult.set(it.seq, call);
      }
    }
  }
  return { calls, results, resultOf: (call) => resultByCall.get(call.seq), callOf: (result) => callByResult.get(result.seq) };
}
