// toRetell: the test-only inverse of fromRetell. It writes evidence back as the get-call record Retell would have
// returned, so the scrubbed samples (and hand-built evidence) can stand in for real calls without real data entering
// the repo. fromRetell(toRetell(e)) equals e, except two things Retell does not record: tool_result.ok, which the
// adapter leaves null for success resolution, and a turn's interrupted, which reads back as null.
import type { Evidence, Item } from "@/report/schema";

type Utterance = Record<string, unknown>;

/** A Retell get-call record holding this evidence. Throws on items a Retell record cannot hold. */
export function toRetell(evidence: Evidence): unknown {
  const transcript = evidence.ordering === "none" ? "transcript_object" : "transcript_with_tool_calls";
  return {
    call_id: evidence.callId,
    agent_version: evidence.agentVersion !== null && /^\d+$/.test(evidence.agentVersion) ? Number(evidence.agentVersion) : evidence.agentVersion,
    call_status: "ended",
    start_timestamp: evidence.callStartMs,
    ...evidence.callFields,
    [transcript]: evidence.items.map(toUtterance),
  };
}

function toUtterance(item: Item): unknown {
  switch (item.kind) {
    case "turn": {
      const first = item.text.trim().split(/\s+/)[0] ?? "";
      const words = item.startSec === null ? [] : [{ word: first, start: item.startSec, end: item.startSec }];
      return { role: item.role === "agent" ? "agent" : "user", content: item.text, words };
    }
    case "tool_call":
      return { role: "tool_call_invocation", tool_call_id: item.id, name: item.name, arguments: JSON.stringify(item.args) };
    case "tool_result": {
      const result: Utterance = { role: "tool_call_result", tool_call_id: item.id, content: toContent(item.payload) };
      if (item.platformOk !== null) result.successful = item.platformOk;
      return result;
    }
    case "event":
      // The adapter names an item with no readable role "unknown" and keeps it whole, so it goes back whole.
      if (item.type === "unknown") return item.data;
      if (typeof item.data !== "object" || item.data === null || Array.isArray(item.data)) {
        throw new Error(`toRetell: a ${item.type} event needs object data to become a Retell utterance`);
      }
      return { role: item.type, ...item.data };
    case "backend_action":
      throw new Error("toRetell: a Retell record holds no backend_action items; those are Tier 2 evidence");
  }
}

/** Retell's content string for a payload. A text payload that would parse as JSON is quoted, so it reads back as text. */
function toContent(payload: unknown): string {
  if (typeof payload !== "string") return JSON.stringify(payload ?? null);
  try {
    JSON.parse(payload);
    return JSON.stringify(payload);
  } catch {
    return payload;
  }
}
