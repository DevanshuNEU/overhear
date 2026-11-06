// The engine's own words: the detail a gap carries. Code values map to these and nothing else writes them.
import type { GapCode } from "@/report/schema";

/** The detail an evidence gap carries, by code. Codes are added as the engine learns to raise them. */
export const GAP_TEXT = {
  missing_tool_transcript: "Retell kept the conversation but not its tool calls, so what the system did and when can't be checked.",
} satisfies Partial<Record<GapCode, string>>;

/** The detail of an unknown_success gap: a tool result that says neither way whether it worked. */
export function unknownSuccessDetail(tool: string): string {
  return `Neither the ${tool} result nor Retell says whether it worked, so anything that rests on it can't be checked.`;
}
