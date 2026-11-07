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

/** The detail of an unknown_success gap where Retell says the call went through but the result reads like an error. */
export function unknownSuccessConflictDetail(tool: string): string {
  return `Retell says the ${tool} call went through, but its result reads like an error, so whether it worked can't be checked.`;
}

/** Why a committed detail has no value to compare: no lookup offered it, or the record has it scrubbed. */
export type UnresolvedWhy = "no_source" | "scrubbed";

/** The detail of an unresolved_committed_detail gap: one detail a change committed that can't be read back. */
export function unresolvedDetail(field: string, tool: string, why: UnresolvedWhy): string {
  if (why === "scrubbed") {
    return `The ${field} the ${tool} call committed is hidden by Retell's privacy setting, so it can't be compared with what the agent said.`;
  }
  return `The ${field} the ${tool} call committed can't be found in the record, so it can't be compared with what the agent said.`;
}
