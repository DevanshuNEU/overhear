// Retell's custom-function request carries the whole call so far in
// `call.transcript_with_tool_calls`. The call this request is serving is an
// invocation of this tool that has no result yet. When several are open at
// once (parallel calls to one tool), the one whose arguments equal the
// request's `args` wins; otherwise the last open one. Returns null when the
// payload has no tool name, no transcript, no such invocation, or the
// invocation is already answered, so a missing id is recorded as missing
// rather than guessed.
type Item = { role?: unknown; tool_call_id?: unknown; name?: unknown; arguments?: unknown };

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

export function inFlightToolCallId(
  body: { name?: string; args?: unknown; call?: { transcript_with_tool_calls?: unknown[] } },
): string | null {
  const items = body.call?.transcript_with_tool_calls;
  if (typeof body.name !== "string" || !Array.isArray(items)) return null;
  const answered = new Set<string>();
  for (const raw of items) {
    const item = raw as Item | null;
    if (item && typeof item === "object" && item.role === "tool_call_result" && typeof item.tool_call_id === "string") {
      answered.add(item.tool_call_id);
    }
  }
  const open: Item[] = [];
  for (const raw of items) {
    const item = raw as Item | null;
    if (!item || typeof item !== "object" || item.role !== "tool_call_invocation") continue;
    if (typeof item.tool_call_id !== "string" || item.name !== body.name) continue;
    if (!answered.has(item.tool_call_id)) open.push(item);
  }
  if (open.length === 0) return null;
  const want = JSON.stringify(body.args ?? {});
  const exact = open.filter((i) => JSON.stringify(parseArgs(i.arguments) ?? {}) === want);
  const pick = exact.length > 0 ? exact[exact.length - 1] : open[open.length - 1];
  return pick.tool_call_id as string;
}
