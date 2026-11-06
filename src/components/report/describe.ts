// What a thing the system did is called on screen, and the raw record behind it.
import type { Evidence, Item } from "@/report/schema";
import { backendActionLine, eventLine, toolCallLine, toolResultLine } from "@/report/labels";

export type DidLine = { line: string; raw: unknown; backend: boolean };

/** The one line an item gets in the Did lane and the timeline. A turn is not something the system did, so it gets none. */
export function describeDid(item: Item, evidence: Evidence): DidLine | null {
  // A result is named by the call it answers. If its id belongs to more than one call it answers none for sure,
  // so it keeps the id and takes no tool's name.
  const callName = (id: string) => {
    const calls = evidence.items.filter((x) => x.kind === "tool_call" && x.id === id);
    return calls.length === 1 && calls[0].kind === "tool_call" ? calls[0].name : id;
  };
  switch (item.kind) {
    case "tool_call":
      return { line: toolCallLine(item.name), raw: item.args, backend: false };
    case "tool_result":
      return { line: toolResultLine(callName(item.id), item.ok), raw: item.payload, backend: false };
    case "backend_action":
      return { line: backendActionLine(item.tool, item.ok), raw: { args: item.args, result: item.result, ts: item.ts }, backend: true };
    case "event":
      return { line: eventLine(item.type), raw: item.data, backend: false };
    case "turn":
      return null;
  }
}
