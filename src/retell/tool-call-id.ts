// Retell's custom-function request carries the whole call so far in
// `call.transcript_with_tool_calls`. The call this request is serving is the
// last invocation of this tool that has no result yet. Returns null when the
// payload has no transcript, no such invocation, or the invocation is already
// answered, so a missing id is recorded as missing rather than guessed.
type Item = { role?: unknown; tool_call_id?: unknown; name?: unknown };

export function inFlightToolCallId(
  body: { name?: string; call?: { transcript_with_tool_calls?: unknown[] } },
): string | null {
  const items = body.call?.transcript_with_tool_calls;
  if (!Array.isArray(items)) return null;
  const answered = new Set<string>();
  for (const raw of items) {
    const item = raw as Item | null;
    if (item && typeof item === "object" && item.role === "tool_call_result" && typeof item.tool_call_id === "string") {
      answered.add(item.tool_call_id);
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as Item | null;
    if (!item || typeof item !== "object" || item.role !== "tool_call_invocation") continue;
    if (typeof item.tool_call_id !== "string" || item.name !== body.name) continue;
    if (!answered.has(item.tool_call_id)) return item.tool_call_id;
  }
  return null;
}
