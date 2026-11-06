// @vitest-environment node
import { describe, expect, it } from "vitest";
import { needsReviewSample } from "@/report/samples";
import { ev } from "./build";
import { toRetell } from "./retell";

type Utterance = Record<string, unknown>;

/** The transcript_with_tool_calls of a record toRetell wrote. */
const transcript = (raw: unknown) => (raw as { transcript_with_tool_calls: Utterance[] }).transcript_with_tool_calls;

describe("toRetell", () => {
  it("writes a get-call record the way Retell does: string arguments and content, user for the caller", () => {
    const raw = toRetell(
      ev([
        { kind: "turn", role: "caller", text: "Book me with Dr. Priya Nair.", startSec: 1.25, interrupted: null },
        { kind: "tool_call", id: "tc_1", name: "book_appointment", args: { slotId: "s-1" } },
        { kind: "tool_result", id: "tc_1", ok: true, platformOk: true, payload: { ok: true } },
        { kind: "turn", role: "agent", text: "Done.", startSec: null, interrupted: null },
      ]),
    );
    expect(raw).toMatchObject({ call_id: "call_test", call_status: "ended", agent_version: null, start_timestamp: null });
    expect(transcript(raw)).toEqual([
      { role: "user", content: "Book me with Dr. Priya Nair.", words: [{ word: "Book", start: 1.25, end: 1.25 }] },
      { role: "tool_call_invocation", tool_call_id: "tc_1", name: "book_appointment", arguments: '{"slotId":"s-1"}' },
      { role: "tool_call_result", tool_call_id: "tc_1", content: '{"ok":true}', successful: true },
      { role: "agent", content: "Done.", words: [] },
    ]);
  });

  it("keeps a plain-text result as it is, and quotes one that would read as JSON", () => {
    const [, result] = transcript(toRetell(needsReviewSample.evidence)).filter((u) => String(u.role).startsWith("tool_call"));
    expect(result.content).toMatch(/^HTTP 500: /);
    const quoted = transcript(
      toRetell(ev([{ kind: "tool_call", id: "a", name: "t", args: {} }, { kind: "tool_result", id: "a", ok: null, platformOk: null, payload: "42" }])),
    );
    expect(quoted[1]).toEqual({ role: "tool_call_result", tool_call_id: "a", content: '"42"' });
  });

  it("writes a numeric agent version as a number", () => {
    expect(toRetell(ev([], { agentVersion: "0" }))).toMatchObject({ agent_version: 0 });
    expect(toRetell(ev([], { agentVersion: "v2" }))).toMatchObject({ agent_version: "v2" });
  });

  it("writes an event back as its role and data", () => {
    const raw = toRetell(ev([{ kind: "event", type: "dtmf", data: { digit: "1" } }]));
    expect(transcript(raw)).toEqual([{ role: "dtmf", digit: "1" }]);
  });

  it("writes evidence with ordering none as transcript_object", () => {
    const raw = toRetell(ev([{ kind: "turn", role: "agent", text: "Hi", startSec: null, interrupted: null }], { ordering: "none" }));
    expect(raw).toMatchObject({ transcript_object: [{ role: "agent", content: "Hi", words: [] }] });
    expect(raw).not.toHaveProperty("transcript_with_tool_calls");
  });

  it("refuses evidence Retell cannot hold: backend actions", () => {
    const tier2 = ev(
      [{ kind: "backend_action", id: "b", toolCallId: null, tool: "book", args: {}, result: null, ok: true, ts: "2026-11-06T10:00:00Z", link: null }],
      { tier: 2 },
    );
    expect(() => toRetell(tier2)).toThrow(/backend_action/);
  });
});
